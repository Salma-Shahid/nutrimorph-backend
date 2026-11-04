const mongoose = require("mongoose");

const geminiUsageSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true },
    apiCalls: { type: Number, default: 0 },
    promptTokens: { type: Number, default: 0 },
    candidateTokens: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("GeminiUsage", geminiUsageSchema);
