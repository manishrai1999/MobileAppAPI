const mongoose = require('mongoose');
const SattaKing = mongoose.connection.useDb('SattaKing');

const LuckySchema = mongoose.Schema({
    cardTitle:{
        type:String,
        require:false
    },
    number:{
        type:String,
        require:false
    },
    isReveled:{
        type:Boolean,
        require:false
    },
    isBtn:{
        type:Boolean,
        require:false
    },
    adUnit:{
        type:String,
        require:false
    }

}, {collection: 'LuckyNumbers'});

const LuckyNumber = SattaKing.model('LuckyNumbers', LuckySchema);

module.exports = LuckyNumber;
