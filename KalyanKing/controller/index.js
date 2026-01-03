const LiveResult = require("../modals/liveresult.model");

const getLiveResults = async (req, res) => {
  LiveResult.find()
    .sort({ isTop: -1 })
    .then((items) => {
      return res.status(200).json({ liveResults: items });
    })
    .catch(function () {
      console.log("error");
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

module.exports = { getLiveResults, updateLiveResult };

