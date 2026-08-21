const LiveResult = require("../modals/liveresult.model");
const LuckyNumber = require("../modals/luckynumber.model");
const HistoricalChart = require('../modals/historicalchart.model');
const {
  updateKalyanResults,
  getTestingLiveResults: getTestingLiveResultsFromCollection,
  probeSourceVsDatabase,
} = require("../../KalyanAutoUpdateResult");
const {
  discoverChartLinks,
  describeChartPage,
  matchMarketsToChartLinks,
  updateChartsForMarkets,
} = require("../../KalyanChartScraper");

const getLiveResults = async (req, res) => {
  // priority = persistent importance tier; isTop = whichever result landed most
  // recently. The app re-sorts by result time on the client (a market that is
  // live right now outranks one that closed hours ago), so this ordering is the
  // fallback for older builds and the admin view.
  LiveResult.find()
    .sort({ priority: -1, isTop: -1 })
    .then((items) => {
      return res.status(200).json({ liveResults: items });
    })
    .catch(function () {
      console.log("error");
    });
};



const getHistoricalData = async (req, res) => {
  try {
    // 1. Extract parameters from the query string
    const { game, month, year } = req.query;

    // 2. Build a dynamic filter object
    const filter = {};
    
    if (game) filter.gameName = game; // Maps 'game' param to 'gameName' field
    if (month) filter.month = month;
    if (year) filter.year = Number(year); // Ensure year is treated as a number

    // 3. Execute the query with the filter
    const items = await HistoricalChart.find(filter).sort({ index: 1 });

    return res.status(200).json({ 
      success: true,
      count: items.length,
      historicalChart: items 
    });

  } catch (error) {
    console.error("Error fetching historical data:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Internal Server Error" 
    });
  }
};

const getLuckyNumber = async (req, res) => {
  LuckyNumber.find()
    .then((data) => {
      return res.status(200).json({ LuckyNumber: data });
    })
    .catch(function () {
      console.log("reject");
    });
};

const updateLiveResult = async (req, res) => {
  const { ResultID, ResultNo, ResultType } = req.body;
  if (ResultType == "today") {
    const updateMany = {
      $set: {
        isTop: false,
      },
    };
    LiveResult.updateMany({}, updateMany).then((data) => {
      const dataset = { $set: { todayResult: ResultNo, isTop: true } };
      LiveResult.updateOne({ _id: ResultID }, dataset).then((data) => {
        return res.json("ok");
      });
    });
  }
  if (ResultType == "last") {
    const updateMany = {
      $set: {
        isTop: false,
      },
    };
    LiveResult.updateMany({}, updateMany).then((data) => {
      const dataset = { $set: { lastResult: ResultNo, isTop: true } };
      LiveResult.updateOne({ _id: ResultID }, dataset).then((data) => {
        return res.json("ok");
      });
    });
  }
};

const autoUpdateLiveResult = async (req, res) => {
  try {
    const summary = await updateKalyanResults();

    return res.status(200).json({
      message: "Kalyan results updated successfully",
      ...summary,
    });
  } catch (error) {
    console.error("Kalyan auto update API failed:", error.message);

    return res.status(500).json({
      message: "Kalyan results update failed",
      error: error.message,
    });
  }
};

const getTestingLiveResults = async (req, res) => {
  try {
    const testingLiveResults = await getTestingLiveResultsFromCollection();

    return res.status(200).json({
      testingLiveResults,
    });
  } catch (error) {
    console.error("Get testing live results failed:", error.message);

    return res.status(500).json({
      message: "Get testing live results failed",
      error: error.message,
    });
  }
};

// Read-only diagnostic: which markets the source publishes that we don't store.
// Runs server-side because the source blocks non-datacenter IPs. Writes nothing.
/**
 * Read-only diagnostic for the historical chart source.
 *
 * The `historicalchart` collection has had nothing written to it since December
 * 2025 and there has never been a writer for it, so Old Chart is empty for
 * every 2026 month. Before a parser can be written, somebody has to see the
 * markup — and the source blocks residential IPs, so that has to happen from
 * the server. Same reason probeSource exists.
 *
 *   GET /KalyanKing/probeChartSource            → chart URLs found on the homepage
 *   GET /KalyanKing/probeChartSource?url=<enc>  → table structure of that page
 *
 * Writes nothing.
 */
const probeChartSource = async (req, res) => {
  try {
    const { url } = req.query;

    if (url) {
      const report = await describeChartPage(String(url));
      return res.status(report.ok ? 200 : 502).json(report);
    }

    const report = await discoverChartLinks();
    if (!report.ok) return res.status(502).json(report);

    // Coverage is every curated market, so report which of them the source
    // actually publishes a chart for. Names come from the live-results
    // collection — the same list the app shows.
    const markets = await LiveResult.find({}, "gameName").lean();
    report.marketCoverage = matchMarketsToChartLinks(
      markets.map((doc) => doc.gameName),
      report.allChartLinks
    );

    return res.status(200).json(report);
  } catch (error) {
    console.error("Probe chart source failed:", error.message);
    return res
      .status(500)
      .json({ message: "Probe chart source failed", error: error.message });
  }
};

/**
 * Scrape the panel charts and upsert them into historicalchart.
 *
 *   GET /KalyanKing/autoUpdateHistoricalChart
 *       ?offset=0        market index to start at        (default 0)
 *       &limit=6         markets per invocation          (default 6)
 *       &mode=recent     recent | full                   (default recent)
 *       &recentWeeks=6   weeks to upsert in recent mode  (default 6)
 *
 * CHUNKED ON PURPOSE. 38 markets at ~200KB a page cannot be fetched
 * sequentially inside a serverless execution limit, so the caller walks the
 * list using `nextOffset` from the response until `done` is true.
 *
 * Daily cron: mode=recent, called repeatedly until done.
 * Backfill:   mode=full — one pass per market loads its whole history, since
 *             the source publishes every week on a single page.
 *
 * Ordering matches getLiveResults so offsets stay stable between calls.
 */
const autoUpdateHistoricalChart = async (req, res) => {
  try {
    const toInt = (value, fallback) => {
      const parsed = Number.parseInt(String(value ?? ""), 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };

    const markets = await LiveResult.find({}, "gameName")
      .sort({ priority: -1, gameName: 1 })
      .lean();

    const summary = await updateChartsForMarkets(
      markets.map((doc) => doc.gameName),
      {
        offset: toInt(req.query.offset, 0),
        // Capped: a caller asking for all 38 in one go would time out and look
        // like a source failure rather than a budget problem.
        limit: Math.min(toInt(req.query.limit, 6), 10),
        mode: req.query.mode === "full" ? "full" : "recent",
        recentWeeks: Math.min(toInt(req.query.recentWeeks, 6), 60),
      }
    );

    // 207 when some markets failed but others were written — the run partially
    // succeeded and the caller should still advance to nextOffset.
    return res.status(summary.ok ? 200 : 207).json(summary);
  } catch (error) {
    console.error("Historical chart update failed:", error.message);
    return res
      .status(500)
      .json({ message: "Historical chart update failed", error: error.message });
  }
};

const probeSource = async (req, res) => {
  try {
    const report = await probeSourceVsDatabase();
    return res.status(200).json(report);
  } catch (error) {
    console.error("Probe source failed:", error.message);
    return res.status(500).json({ message: "Probe source failed", error: error.message });
  }
};

module.exports = {
  probeSource,
  probeChartSource,
  autoUpdateHistoricalChart,
  getLiveResults,
  updateLiveResult,
  getLuckyNumber,
  autoUpdateLiveResult,
  getTestingLiveResults,
  getHistoricalData
};

