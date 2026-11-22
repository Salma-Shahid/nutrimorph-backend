const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  reviewId: { type: String, unique: true },
  author: String,
  comment: String,
  rating: Number,
  isHidden: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("Review", reviewSchema);
