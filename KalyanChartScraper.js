const axios = require("axios");
const cheerio = require("cheerio");

/**
 * Historical (panel) chart scraping for KalyanKing.
 *
 * WHY THIS FILE STARTS AS A PROBE
 * ────────────────────────────────
 * The `historicalchart` collection stopped receiving data after December 2025,
 * so the app's Old Chart tab renders an empty table for every month in 2026.
 * There has never been a writer for it — `KalyanKing/routers` exposes
 * getHistoricalData (read) and nothing else — so the data was presumably loaded
 * by hand once and then went stale.
 *
 * The source (dpboss) blocks residential IPs: it answers Vercel's datacenter
 * IPs but the connection dies locally, exactly as noted on probeSourceVsDatabase
 * in KalyanAutoUpdateResult.js. Verified again while writing this — the CDN edge
 * returns a 301 to a dev machine and then the redirect target never completes.
 *
 * That means a chart parser CANNOT be written blind from a dev machine: nobody
 * can see the markup it has to parse. So this ships as a read-only probe first,
 * the same way probeSource was used to see the live-results markup server-side.
 * Deploy, hit the endpoint, read the real structure out of the response, then
 * write the parser against it in a second pass.
 *
 * Nothing here writes to the database. Nothing here has side effects.
 */

const SOURCE_ORIGIN = "https://dpboss.boston";

// The host we are willing to fetch. This endpoint takes a URL parameter, and an
// unrestricted server-side fetcher on a public route is an SSRF hole — it would
// happily fetch cloud metadata endpoints or anything else reachable from the
// Vercel function. Only the scrape source is allowed.
const ALLOWED_HOSTS = new Set(["dpboss.boston", "www.dpboss.boston"]);

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const TIMEOUT_MS = 30000;

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isAllowedUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchPage(url) {
  const response = await axios.get(url, {
    headers: REQUEST_HEADERS,
    timeout: TIMEOUT_MS,
    maxRedirects: 5,
    // Report the status rather than throwing, so the probe can tell the
    // difference between "blocked" and "wrong path".
    validateStatus: () => true,
  });

  return {
    status: response.status,
    finalUrl: response.request?.res?.responseUrl || url,
    contentType: response.headers?.["content-type"] || "",
    length: typeof response.data === "string" ? response.data.length : 0,
    html: typeof response.data === "string" ? response.data : "",
  };
}

/**
 * Step 1 — discover the chart URLs from the homepage.
 *
 * Guessing paths (`/panel-chart-record/kalyan.php` and friends) is how you end
 * up with a scraper that silently breaks. The homepage links to every chart it
 * publishes, so read them off it instead and let the source tell us its own URL
 * scheme.
 */
async function discoverChartLinks() {
  const page = await fetchPage(`${SOURCE_ORIGIN}/`);

  if (page.status !== 200 || !page.html) {
    return {
      ok: false,
      reason: `Homepage returned HTTP ${page.status}`,
      status: page.status,
      finalUrl: page.finalUrl,
    };
  }

  const $ = cheerio.load(page.html);
  const links = [];
  const seen = new Set();

  $("a[href]").each((_, el) => {
    const href = String($(el).attr("href") || "");
    const text = cleanText($(el).text());
    const haystack = `${href} ${text}`.toLowerCase();

    if (!/chart|panel|record|jodi/.test(haystack)) return;

    let absolute;
    try {
      absolute = new URL(href, `${SOURCE_ORIGIN}/`).toString();
    } catch {
      return;
    }

    if (seen.has(absolute)) return;
    seen.add(absolute);

    links.push({ text, url: absolute });
  });

  return {
    ok: true,
    status: page.status,
    finalUrl: page.finalUrl,
    linkCount: links.length,
    // Kalyan first — it is the only market with any chart data today, so it is
    // the one to wire the parser against before fanning out.
    kalyanLinks: links.filter((l) => /kalyan/i.test(`${l.url} ${l.text}`)),
    allChartLinks: links,
  };
}

/**
 * Match every curated market to a chart URL on the source.
 *
 * Coverage is all curated markets, not just Kalyan, so the writer needs a
 * market → URL map. Building that by hand for 38 markets would rot the first
 * time the source renames a page, so derive it: read the markets out of the
 * live-results collection, read the chart links off the homepage, and match on
 * a normalised slug.
 *
 * Returns the unmatched markets too — those are the ones that need a manual
 * URL or genuinely have no chart published, and silently dropping them is how
 * you end up believing coverage is complete when it isn't.
 *
 * Read-only. `markets` is injected so this file never imports a model.
 */
function matchMarketsToChartLinks(markets, chartLinks) {
  const slug = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const linkBySlug = new Map();
  for (const link of chartLinks) {
    // The last path segment is the market identifier on every chart URL scheme
    // this source has used ("/panel-chart-record/kalyan.php" → "kalyan").
    let segment = "";
    try {
      segment = new URL(link.url).pathname.split("/").filter(Boolean).pop() || "";
    } catch {
      continue;
    }
    const key = slug(segment.replace(/\.(php|html?|aspx)$/i, ""));
    if (key && !linkBySlug.has(key)) linkBySlug.set(key, link);
  }

  const matched = [];
  const unmatched = [];

  for (const market of markets) {
    const key = slug(market);
    const hit = linkBySlug.get(key);
    if (hit) matched.push({ gameName: market, url: hit.url, linkText: hit.text });
    else unmatched.push(market);
  }

  return {
    marketCount: markets.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    matched,
    unmatched,
    // Chart pages the source publishes that no curated market claims.
    unclaimedLinks: [...linkBySlug.entries()]
      .filter(([key]) => !markets.some((m) => slug(m) === key))
      .map(([, link]) => link.url),
  };
}

/**
 * Step 2 — describe the table structure of one chart page.
 *
 * Returns enough shape to write a parser against: how many tables, their
 * dimensions, the header row, and the first few data rows cell-by-cell. Also
 * returns a trimmed HTML sample of the widest table, because panel charts
 * encode the top/main/bottom triplet in nested markup that cell text alone
 * does not reveal.
 */
async function describeChartPage(url) {
  if (!isAllowedUrl(url)) {
    return { ok: false, reason: "URL is not on the allowed source host" };
  }

  const page = await fetchPage(url);

  if (page.status !== 200 || !page.html) {
    return {
      ok: false,
      reason: `Page returned HTTP ${page.status}`,
      status: page.status,
      finalUrl: page.finalUrl,
    };
  }

  const $ = cheerio.load(page.html);
  const tables = [];

  $("table").each((tableIndex, table) => {
    const rows = $(table).find("tr");
    if (rows.length === 0) return;

    const rowSample = [];
    rows.slice(0, 4).each((_, row) => {
      const cells = [];
      $(row)
        .find("th, td")
        .each((__, cell) => {
          cells.push({
            text: cleanText($(cell).text()),
            // Panel charts stack the three panna digits inside one cell; the
            // child markup is how you tell top/main/bottom apart.
            childTags: $(cell)
              .children()
              .map((___, child) => child.tagName)
              .get(),
          });
        });
      rowSample.push(cells);
    });

    tables.push({
      tableIndex,
      className: $(table).attr("class") || "",
      id: $(table).attr("id") || "",
      rowCount: rows.length,
      maxColumns: Math.max(
        0,
        ...rows.map((_, row) => $(row).find("th, td").length).get()
      ),
      rowSample,
    });
  });

  // The chart is almost certainly the biggest table on the page.
  const widest = tables.slice().sort((a, b) => b.rowCount - a.rowCount)[0];
  const widestHtml = widest
    ? cleanText($("table").eq(widest.tableIndex).html() || "").slice(0, 4000)
    : "";

  return {
    ok: true,
    status: page.status,
    finalUrl: page.finalUrl,
    contentType: page.contentType,
    htmlLength: page.length,
    tableCount: tables.length,
    tables,
    widestTableIndex: widest ? widest.tableIndex : null,
    // Truncated on purpose — this is a diagnostic response, not a mirror.
    widestTableHtmlSample: widestHtml,
  };
}

module.exports = {
  SOURCE_ORIGIN,
  discoverChartLinks,
  describeChartPage,
  matchMarketsToChartLinks,
  isAllowedUrl,
};
