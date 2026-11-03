const mongoose = require("mongoose");

const waterSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: String, // Format: YYYY-MM-DD
      required: true,
    },
    glasses: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

// Ensure there is one record per user and date.
waterSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Water", waterSchema);
