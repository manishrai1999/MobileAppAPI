const mongoose = require("mongoose");

const SattaKing = mongoose.connection.useDb("SattaKing");

const KhabarSchema = mongoose.Schema(
  {
    resultName: {
      type: String,
      require: false,
    },
    resultTime: {
      type: String,
      require: false,
    },
    lastResult: {
      type: String,
      require: false,
    },
    todayResult: {
      type: String,
      require: false,
    },
    top: {
      type: Boolean,
      require: false,
    },
  },
  { collection: "DailyResults" }
);

const dailyKhabar = SattaKing.model("DailyResults", KhabarSchema);

module.exports = dailyKhabar;
