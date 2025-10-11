const mongoose = require('mongoose');
const SattaKing = mongoose.connection.useDb('SattaKing');

const MonthlyChartSchema = mongoose.Schema({
    date: {
        type: String,
        require: false
    },
    // Add other fields as needed based on your chart data structure
    // You can expand this schema based on what data you store in monthlyChart collection
}, {collection: 'monthlyChart'});

const MonthlyChart = SattaKing.model('monthlyChart', MonthlyChartSchema);

module.exports = MonthlyChart;
