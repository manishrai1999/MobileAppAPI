const express = require("express");
const router = express.Router();
const { getLiveResults, updateLiveResult, getLuckyNumber } = require("../controller");

router.get("/liveResults", getLiveResults);

router.get("/luckyNumber", getLuckyNumber);

router.post("/updateLiveResult", updateLiveResult);

module.exports = router;

