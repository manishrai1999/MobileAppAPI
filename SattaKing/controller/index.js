const Khabar = require("../modals/khabar.model");
const Image = require("../modals/image.model");
const Lucky = require("../modals/luckynumber.model");
const SingleJodi = require("../modals/singlejodi.model");

const getDailyKhabars = async (req, res) => {
  Khabar.find()
    .sort({ top: -1 })
    .then((items) => {
      return res.status(200).json({ DailyKhabar: items });
    })
    .catch(function () {
      console.log("error");
    });
};

const newSingleJodi = async (req, res) => {
  const singleJodi = new SingleJodi({
    khabarName:'SattaKing',
    singleJodi:65
  });
  singleJodi.save();
  return res.json("ok");
};

const getSingleJodi = async (req, res) => {
  SingleJodi.find()
    .then((items) => {
      return res.status(200).json({ singleJodi: items });
    })
    .catch(function () {
      console.log("error");
    });
};

const getImageBanner = async (req, res) => {
  Image.find()
    .then((items) => {
      return res.status(200).json({ imageBanner: items });
    })
    .catch(function () {
      console.log("error");
    });
};

const getLuckyNumber = async (req, res) => {
  Lucky.find()
    .then((data) => {
      return res.status(200).json({ LuckyNumber: data });
    })
    .catch(function () {
      console.log("reject");
    });
};

const createLuckyNumber = async (req, res) => {
  const luckyNumber = new Lucky({
    cardTitle: 'Single Jodi(सिंगल जोड़ी)',
    number: '65 - 77',
    isReveled: false,
    isBtn: false,
    adUnit: 'ca-app-pub-9210620605814123/1167024627'
  });
  luckyNumber.save();
  return res.json("Lucky number created successfully");
};

const updateDailyKhabar = async (req, res) => {
  const { KhabarID, KhabarNo, KhabarType } = req.body;
  if (KhabarType == "today") {
    const updateMany = {
      $set: {
        top: false,
      },
    };
    Khabar.updateMany({}, updateMany).then((data) => {
      const dataset = { $set: { todayResult: KhabarNo, top: true } };
      Khabar.updateOne({ _id: KhabarID }, dataset).then((data) => {
        return res.json("ok");
      });
    });
  }
  if (KhabarType == "last") {
    const updateMany = {
      $set: {
        top: false,
      },
    };
    Khabar.updateMany({}, updateMany).then((data) => {
      const dataset = { $set: { lastResult: KhabarNo, top: true } };
      Khabar.updateOne({ _id: KhabarID }, dataset).then((data) => {
        return res.json("ok");
      });
    });
  }
};

module.exports = { getDailyKhabars, getImageBanner, getLuckyNumber, createLuckyNumber, updateDailyKhabar, newSingleJodi, getSingleJodi };
