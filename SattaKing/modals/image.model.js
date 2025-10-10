const mongoose = require("mongoose");
const SattaKing = mongoose.connection.useDb("SattaKing");

const ImageSchema = mongoose.Schema(
  {
    image_url: {
      type: String,
      require: false,
    },
    link_url: {
      type: String,
      require: false,
    },
  },
  { collection: "Images" }
);

const Image = SattaKing.model("Images", ImageSchema);

module.exports = Image;
