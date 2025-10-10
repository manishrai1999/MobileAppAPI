const mongoose = require('mongoose');
const URL = 'mongodb+srv://SattaKing:Kaka5611@cluster0.gzspqod.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(URL,{
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(()=>{
    console.log('Connection Sucessful');
}).catch((err) =>{
    console.log(err);
})