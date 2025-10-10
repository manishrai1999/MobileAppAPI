const express = require("express");
const router = express.Router();
const { getDailyKhabars, getImageBanner, getLuckyNumber, createLuckyNumber, updateDailyKhabar, newSingleJodi, getSingleJodi } = require("../controller");

router.get("/dailyKhabar", getDailyKhabars);

router.get("/imageBanner", getImageBanner);

router.get("/luckyNumber", getLuckyNumber);

router.post("/createLuckyNumber", createLuckyNumber);

router.post("/updateKhabar", updateDailyKhabar);

router.get("/newSingleJodi", newSingleJodi);

router.get("/getSingleJodi", getSingleJodi);

module.exports = router;
