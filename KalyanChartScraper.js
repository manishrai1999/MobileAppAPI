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

// Distinguishes the panel chart (top/main/bottom) from the jodi chart (main
// only). The schema needs the panel.
const PANEL_PATH_RE = /panel-chart-record/i;

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
    let pathname = "";
    try {
      pathname = new URL(link.url).pathname;
    } catch {
      continue;
    }
    const segment = pathname.split("/").filter(Boolean).pop() || "";
    const key = slug(segment.replace(/\.(php|html?|aspx)$/i, ""));
    if (!key) continue;

    // The source publishes BOTH a jodi chart and a panel chart per market, and
    // lists jodi first. Only the panel chart carries the top/main/bottom
    // triplet the historicalchart schema stores — a jodi page has just the
    // two-digit number — so panel always wins regardless of link order.
    const isPanel = PANEL_PATH_RE.test(pathname);
    const existing = linkBySlug.get(key);
    if (!existing || (isPanel && !PANEL_PATH_RE.test(new URL(existing.url).pathname))) {
      linkBySlug.set(key, link);
    }
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

// ───────────────────────────────────────────────────────────────────────────
//  Parser + writer
//
//  Structure confirmed against the live source via probeChartSource:
//
//    table.panel-chart.chart-table
//      row 0  : 7  cells — "Date", Mon, Tue, Wed, Thu, Fri, Sat
//      row 1+ : 19 cells — 1 date cell, then 6 days x 3 (top, main, bottom)
//
//  Kalyan's page carries 202 rows going back to Oct 2022, so ONE fetch is a
//  market's entire history. The backfill is therefore one pass per market, not
//  a month-by-month crawl.
//
//  Days with no result publish as "* * *" / "**" (holiday, or not yet
//  declared). Those are absent days, not data, and are omitted rather than
//  stored as literal asterisks.
// ───────────────────────────────────────────────────────────────────────────

const mongoose = require("mongoose");
const HistoricalChart = require("./KalyanKing/modals/historicalchart.model");

// Markets do NOT all trade the same days, and the chart width follows:
//   Kalyan Night   Mon–Fri  → 16 columns
//   Kalyan         Mon–Sat  → 19 columns
//   Milan Day      Mon–Sun  → 22 columns
// So the day set is read off each page's header row rather than assumed. An
// earlier hardcoded 19 would have silently rejected most of the 38 markets.
const ALL_DAY_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_KEYS = ALL_DAY_KEYS;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CELLS_PER_DAY = 3; // top panna, main jodi, bottom panna

async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return;
  }
  const mongoUrl = process.env.MONGODB_URI || process.env.DATABASE;
  if (!mongoUrl) throw new Error("MONGODB_URI or DATABASE is missing in .env");
  await mongoose.connect(mongoUrl);
}

/** "* * *" and "**" mean no result was published for that day. */
function hasValue(text) {
  const value = cleanText(text);
  return value !== "" && !/^[*\s]+$/.test(value);
}

/**
 * "7 8 0" -> ["7","8","0"]. The source separates panna digits with <br>.
 *
 * Accepts the unseparated form too. cheerio's .text() renders <br> as nothing,
 * so "7<br>8<br>0" collapses to "780" — the live page only reads as "7 8 0"
 * because it happens to have whitespace around its <br> tags. Relying on that
 * whitespace means a cosmetic change at the source silently drops every panna
 * in the chart, so handle both shapes.
 */
function parsePanna(text) {
  if (!hasValue(text)) return null;

  const spaced = cleanText(text).split(/\s+/).filter((d) => /^\d$/.test(d));
  if (spaced.length === 3) return spaced;

  const joined = cleanText(text).replace(/\s+/g, "");
  if (/^\d{3}$/.test(joined)) return joined.split("");

  return null;
}

/** "51" -> "51". A jodi is two digits. */
function parseJodi(text) {
  if (!hasValue(text)) return null;
  const value = cleanText(text).replace(/\s+/g, "");
  return /^\d{2}$/.test(value) ? value : null;
}

/**
 * "17/10/2022 to 22/10/2022" -> start/end Dates plus the dd/mm/yy form.
 *
 * Stored as dd/mm/yy because that is what the rows already in the collection
 * use, and dateRange is half the upsert key — emitting the source's 4-digit
 * year would duplicate every existing row instead of updating it.
 */
function parseDateRange(text) {
  // Three formats observed across markets, so do not tighten this regex:
  //   "17/10/2022 to 22/10/2022"   Kalyan       slashes, spaced separator
  //   "07-01-2019 To 11-01-2019"   Kalyan Night hyphens, capitalised "To"
  //   "08/08/2022to14/08/2022"     Milan Day    slashes, no spaces at all
  const match = cleanText(text).match(
    /(\d{2})[/-](\d{2})[/-](\d{4})\s*to\s*(\d{2})[/-](\d{2})[/-](\d{4})/i
  );
  if (!match) return null;

  const [, d1, m1, y1, d2, m2, y2] = match;
  const start = new Date(Number(y1), Number(m1) - 1, Number(d1));
  if (Number.isNaN(start.getTime())) return null;

  return {
    start,
    dateRange: `${d1}/${m1}/${y1.slice(2)} to ${d2}/${m2}/${y2.slice(2)}`,
    // A week that straddles a month boundary is filed under the month its
    // MONDAY falls in. Deterministic, and every week appears exactly once —
    // majority-of-days would still be ambiguous on a 3/3 split.
    month: MONTH_NAMES[start.getMonth()],
    year: start.getFullYear(),
    // YYYYMMDD: sorts chronologically both within a month and globally.
    // getHistoricalData sorts on this; existing rows have it unset, and a
    // backfill pass fills them in.
    index: start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate(),
  };
}

/**
 * Parse a panel chart page into upsertable week rows.
 *
 * Rows where no day published a result are dropped: writing a week of empty
 * cells is how the Old Chart tab ends up looking broken again, just with rows
 * in it this time.
 */
function parsePanelChartHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];
  const skipped = { badShape: 0, badDate: 0, empty: 0 };

  // Read the traded days off the header row before touching any data row.
  let dayKeys = null;
  $("table.panel-chart tr, table.chart-table tr").each((_, tr) => {
    if (dayKeys) return;
    const labels = $(tr).find("td, th").map((__, c) => cleanText($(c).text())).get();
    if (!/^date$/i.test(labels[0] || "")) return;
    const parsed = labels
      .slice(1)
      .map((l) => l.slice(0, 3).toUpperCase())
      .filter((l) => ALL_DAY_KEYS.includes(l));
    if (parsed.length >= 5) dayKeys = parsed;
  });

  if (!dayKeys) {
    return { rows: [], dayKeys: [], skipped: { ...skipped, noHeader: 1 } };
  }

  const expectedCells = 1 + dayKeys.length * CELLS_PER_DAY;

  $("table.panel-chart tr, table.chart-table tr").each((_, tr) => {
    // <br> carries meaning here (it separates the panna digits) but .text()
    // renders it as nothing. Turn it into whitespace before reading the cell.
    $(tr).find("br").replaceWith(" ");
    const cells = $(tr).find("td, th").map((__, cell) => cleanText($(cell).text())).get();

    // Width is derived from this page's own header. Anything else is the header
    // row itself or a layout change, and counting those is what tells us the
    // parser has gone stale.
    if (cells.length !== expectedCells) {
      if (cells.length > 1) skipped.badShape += 1;
      return;
    }

    const dates = parseDateRange(cells[0]);
    if (!dates) {
      skipped.badDate += 1;
      return;
    }

    const numbers = {};
    dayKeys.forEach((day, i) => {
      const top = parsePanna(cells[1 + i * CELLS_PER_DAY]);
      const main = parseJodi(cells[2 + i * CELLS_PER_DAY]);
      const bottom = parsePanna(cells[3 + i * CELLS_PER_DAY]);
      // The sub-schema requires all three, so a partially declared day (open
      // panna out, close not yet) is not storable and is left absent.
      if (top && main && bottom) numbers[day] = { top, main, bottom };
    });

    if (Object.keys(numbers).length === 0) {
      skipped.empty += 1;
      return;
    }

    rows.push({
      dateRange: dates.dateRange,
      month: dates.month,
      year: dates.year,
      index: dates.index,
      numbers,
    });
  });

  // Newest first, so a "recent weeks only" daily run takes the head.
  rows.sort((a, b) => b.index - a.index);
  return { rows, dayKeys, skipped };
}

/** Fetch and parse one market's panel chart. Read-only. */
async function scrapeMarketChart(url) {
  if (!isAllowedUrl(url)) throw new Error(`Refusing to fetch off-host URL: ${url}`);
  const page = await fetchPage(url);
  if (page.status !== 200 || !page.html) {
    throw new Error(`Source returned HTTP ${page.status} for ${url}`);
  }
  return parsePanelChartHtml(page.html);
}

/**
 * Upsert week rows for one market.
 *
 * Keyed on (gameName, dateRange) so re-running is idempotent and a re-scrape
 * updates a week in place rather than duplicating it. gameName is uppercased by
 * the schema, which is also why a mixed-case query from the app still matches.
 */
async function storeMarketChart(gameName, rows) {
  if (rows.length === 0) return { matched: 0, upserted: 0 };

  const result = await HistoricalChart.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { gameName: String(gameName).toUpperCase(), dateRange: row.dateRange },
        update: {
          $set: {
            gameName: String(gameName).toUpperCase(),
            month: row.month,
            year: row.year,
            index: row.index,
            numbers: row.numbers,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );

  return {
    matched: result.modifiedCount || 0,
    upserted: Object.keys(result.upsertedIds || {}).length,
  };
}

module.exports.DAY_KEYS = DAY_KEYS;
module.exports.parsePanelChartHtml = parsePanelChartHtml;
module.exports.parseDateRange = parseDateRange;
module.exports.parsePanna = parsePanna;
module.exports.parseJodi = parseJodi;
module.exports.scrapeMarketChart = scrapeMarketChart;
module.exports.storeMarketChart = storeMarketChart;
module.exports.ensureMongoConnected = ensureMongoConnected;

/**
 * Panel-chart URL for a market.
 *
 * Confirmed against the live source for all 38 curated markets via
 * discoverChartLinks(): every one resolves to this shape. Constructing it
 * directly avoids a homepage fetch (371 links) on every run, which matters
 * inside a serverless time budget. If the source ever changes its scheme,
 * probeChartSource is still there to show the new one.
 */
function chartUrlFor(gameName) {
  const slug = String(gameName || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${SOURCE_ORIGIN}/panel-chart-record/${slug}.php`;
}

/**
 * Scrape and store charts for a slice of markets.
 *
 * CHUNKED DELIBERATELY. There are 38 markets and each is a separate page
 * fetch of 150–250KB; done sequentially that is well past any serverless
 * execution limit. The caller walks the list with offset/limit and the
 * response hands back `nextOffset` until `done`.
 *
 *   mode "recent" (default) — upsert only the newest `recentWeeks` rows. This
 *     is the daily job: the source page carries years of history but only the
 *     last week or two can have changed.
 *   mode "full" — upsert every row on the page. One pass per market backfills
 *     that market's entire history, because the source publishes it all on one
 *     page (Kalyan 202 weeks, Kalyan Night 393).
 *
 * A market that fails is recorded and the run continues; one dead page must not
 * abort the other 37.
 */
async function updateChartsForMarkets(marketNames, options = {}) {
  const { offset = 0, limit = 6, mode = "recent", recentWeeks = 6 } = options;

  await ensureMongoConnected();

  const slice = marketNames.slice(offset, offset + limit);
  const results = [];
  const failures = [];

  for (const gameName of slice) {
    const url = chartUrlFor(gameName);
    try {
      const { rows, dayKeys, skipped } = await scrapeMarketChart(url);
      const toStore = mode === "full" ? rows : rows.slice(0, recentWeeks);
      const written = await storeMarketChart(gameName, toStore);

      results.push({
        gameName,
        url,
        tradingDays: dayKeys,
        parsedWeeks: rows.length,
        storedWeeks: toStore.length,
        inserted: written.upserted,
        updated: written.matched,
        skipped,
      });
    } catch (error) {
      failures.push({ gameName, url, error: error.message });
    }
  }

  const nextOffset = offset + slice.length;

  return {
    ok: failures.length === 0,
    mode,
    offset,
    limit,
    processed: slice.length,
    totalMarkets: marketNames.length,
    nextOffset,
    done: nextOffset >= marketNames.length,
    insertedTotal: results.reduce((sum, r) => sum + r.inserted, 0),
    updatedTotal: results.reduce((sum, r) => sum + r.updated, 0),
    results,
    failureCount: failures.length,
    failures,
  };
}

module.exports.chartUrlFor = chartUrlFor;
module.exports.updateChartsForMarkets = updateChartsForMarkets;

/**
 * Remove legacy rows that the scrape has superseded.
 *
 * The collection predates the scraper and its dateRange format is not
 * consistent: some hand-entered rows use "03/11/25 to 08/11/25" and others
 * "27/04/2026 to 02/05/2026". The scraper normalises to the two-digit form, so
 * upserts matched the first kind in place and duplicated the second — KALYAN
 * April 2026 ended up with every week listed twice.
 *
 * Legacy rows are identifiable without guessing at formats: `index` was never
 * written before the scraper existed, so any row missing it is hand-entered.
 * A legacy row is only removed when a scraped row (index set) covers the same
 * market and the same week, so nothing is deleted that isn't already replaced.
 *
 * Dry-run unless `apply` is true.
 */
async function cleanupSupersededChartRows({ apply = false } = {}) {
  await ensureMongoConnected();

  const legacy = await HistoricalChart.find({
    $or: [{ index: { $exists: false } }, { index: null }],
  })
    .select("_id gameName dateRange")
    .lean();

  // Two-digit-year form of a dateRange, whatever form it arrived in.
  const normalise = (range) =>
    String(range || "").replace(/\b(\d{2})[/-](\d{2})[/-]\d{2}(\d{2})\b/g, "$1/$2/$3");

  const superseded = [];
  const orphans = [];

  for (const row of legacy) {
    const target = normalise(row.dateRange);
    // eslint-disable-next-line no-await-in-loop
    const replacement = await HistoricalChart.findOne({
      gameName: row.gameName,
      dateRange: target,
      index: { $exists: true, $ne: null },
    })
      .select("_id")
      .lean();

    if (replacement) superseded.push(row);
    else orphans.push({ gameName: row.gameName, dateRange: row.dateRange });
  }

  let deleted = 0;
  if (apply && superseded.length > 0) {
    const result = await HistoricalChart.deleteMany({
      _id: { $in: superseded.map((row) => row._id) },
    });
    deleted = result.deletedCount || 0;
  }

  return {
    applied: apply,
    legacyRows: legacy.length,
    supersededCount: superseded.length,
    deleted,
    // Legacy rows with NO scraped equivalent — a week the source no longer
    // publishes. Left alone: deleting these would lose data, not de-duplicate.
    orphanCount: orphans.length,
    orphans: orphans.slice(0, 50),
    sample: superseded.slice(0, 10).map((r) => ({
      gameName: r.gameName,
      legacy: r.dateRange,
      replacedBy: normalise(r.dateRange),
    })),
  };
}

module.exports.cleanupSupersededChartRows = cleanupSupersededChartRows;
