const express = require("express");
const router = express.Router();
const {
  getLiveResults,
  updateLiveResult,
  getLuckyNumber,
  autoUpdateLiveResult,
  getTestingLiveResults,
  getHistoricalData,
  probeSource,
  probeChartSource,
  autoUpdateHistoricalChart
} = require("../controller");

router.get("/liveResults", getLiveResults);

router.get("/luckyNumber", getLuckyNumber);

router.post("/updateLiveResult", updateLiveResult);

router.get("/historicalData", getHistoricalData);


router.get("/autoUpdateResult", autoUpdateLiveResult);

router.get("/testingLiveResults", getTestingLiveResults);

// Read-only diagnostic — see which markets the source has that we don't store.
router.get("/probeSource", probeSource);

// Read-only diagnostic — see the historical chart source's URLs and markup.
// Must run server-side: the source blocks residential IPs.
router.get("/probeChartSource", probeChartSource);

// Scrape + upsert the panel charts. Chunked via offset/limit — see controller.
router.get("/autoUpdateHistoricalChart", autoUpdateHistoricalChart);

module.exports = router;

