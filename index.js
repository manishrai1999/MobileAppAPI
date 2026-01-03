const express = require("express");
const app = express();
const formData = require('express-form-data');
const DeshawarKing = require("./DeshawarKing/routers");
const SattaKing = require("./SattaKing/routers");
const KalyanKing = require("./KalyanKing/routers");


require('dotenv').config()
require("./DB");

app.use(express.json());
app.use(formData.parse());
app.use('/',require('./DeshawarKing/frontend'));
app.use('/sattaking',require('./SattaKing/frontend'));
app.use('/kalyanking',require('./KalyanKing/frontend'));
app.use("/DeshawarKing", DeshawarKing);
app.use("/SattaKing", SattaKing);
app.use("/KalyanKing", KalyanKing);
app.listen(process.env.PORT || 3000);