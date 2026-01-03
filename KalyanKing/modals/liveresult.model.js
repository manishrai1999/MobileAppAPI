const mongoose = require("mongoose");

const KalyanKing = mongoose.connection.useDb("KalyanKing");

const LiveResultSchema = mongoose.Schema(
  {
    resultName: {
      type: String,
      require: false,
    },
    resultTime: {
      type: String,
      require: false,
    },
    todayResult: {
      type: String,
      require: false,
    },
    lastResult: {
      type: String,
      require: false,
    },
    isTop: {
      type: Boolean,
      require: false,
    },
  },
  { collection: "liveresult" }
);

const LiveResult = KalyanKing.model("liveresult", LiveResultSchema);

module.exports = LiveResult;

