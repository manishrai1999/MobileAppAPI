const express = require("express");
const router = express.Router();
const { getLiveResults, updateLiveResult } = require("../controller");

router.get("/liveResults", getLiveResults);

router.post("/updateLiveResult", updateLiveResult);

module.exports = router;

