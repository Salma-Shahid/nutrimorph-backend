const mongoose = require("mongoose");

const processedPaddleEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "ProcessedPaddleEvent",
  processedPaddleEventSchema,
);
