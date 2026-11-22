const mongoose = require("mongoose");

const weightEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    weight: { type: Number, required: true, min: 15, max: 500 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("WeightEntry", weightEntrySchema);
