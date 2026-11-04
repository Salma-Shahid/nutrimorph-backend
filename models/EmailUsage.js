const mongoose = require("mongoose");

const emailUsageSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true },
    sentCount: { type: Number, default: 0 },
    lastSentAt: { type: Date },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.EmailUsage || mongoose.model("EmailUsage", emailUsageSchema);
