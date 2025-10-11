const mongoose = require('mongoose');
const SattaKing = mongoose.connection.useDb('SattaKing');

const YearlyChartSchema = mongoose.Schema({
    newsName: {
        type: String,
        require: false
    },
    year: {
        type: String,
        require: false
    },
    // Add other fields as needed based on your yearly chart data structure
    // You can expand this schema based on what data you store in yearlyChart collection
}, {collection: 'yearlyChart'});

const YearlyChart = SattaKing.model('yearlyChart', YearlyChartSchema);

module.exports = YearlyChart;
