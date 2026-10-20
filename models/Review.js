const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  reviewId: { type: String, unique: true },
  author: String,
  comment: String,
  rating: Number,
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Review", reviewSchema);
