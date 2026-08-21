const mongoose = require("mongoose");

const KalyanKing = mongoose.connection.useDb("KalyanKing");

// Sub-schema for daily game numbers to keep things clean
const DailyResultSchema = new mongoose.Schema({
  top: { 
    type: [String], 
    required: true 
  },
  main: { 
    type: String, 
    required: true 
  },
  bottom: { 
    type: [String], 
    required: true 
  }
}, { _id: false }); // Set _id to false if you don't want sub-documents to have unique IDs

const HistoricalChartSchema = new mongoose.Schema(
  {
    gameName: {
      type: String,
      required: true,
      uppercase: true
    },
    month: {
      type: String,
      required: true
    },
    year: {
      type: Number,
      required: true
    },
    dateRange: {
      type: String,
      required: true
    },
    // Markets do not all trade the same days. The source publishes Mon–Fri for
    // Kalyan Night, Mon–Sat for Kalyan, and Mon–Sun for Milan Day, Padmavathi
    // Night and Old Main Mumbai. SUN was missing here, so a Sunday result for
    // those markets had nowhere to go — every day the source publishes needs a
    // field or the scrape silently discards it. Days a market does not trade
    // are simply absent on the document.
    numbers: {
      MON: DailyResultSchema,
      TUE: DailyResultSchema,
      WED: DailyResultSchema,
      THU: DailyResultSchema,
      FRI: DailyResultSchema,
      SAT: DailyResultSchema,
      SUN: DailyResultSchema
    },
    index: {
      type: Number
    }
  },
  { 
    collection: "historicalchart",
    timestamps: true // Optional: adds createdAt and updatedAt fields
  }
);

const HistoricalChart = KalyanKing.model("historicalchart", HistoricalChartSchema);

module.exports = HistoricalChart;