const mongoose = require("mongoose");

const KalyanKing = mongoose.connection.useDb("KalyanKing");

const LuckyNumberSchema = mongoose.Schema(
  {
    title: {
      type: String,
      require: false,
    },
    text: {
      type: String,
      require: false,
    },
  },
  { collection: "luckynumber" }
);

const LuckyNumber = KalyanKing.model("luckynumber", LuckyNumberSchema);

module.exports = LuckyNumber;

