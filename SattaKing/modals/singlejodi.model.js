const mongoose = require('mongoose');
const SattaKing = mongoose.connection.useDb('SattaKing');

const SingleJodiSchema = mongoose.Schema({
    khabarName:{
        type:String,
        require:false
    },
    singleJodi:{
        type:String,
        require:false
    }

}, {collection: 'SingleJodi'});

const SingleJodi = SattaKing.model('SingleJodi', SingleJodiSchema);

module.exports = SingleJodi;
