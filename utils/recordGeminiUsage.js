const GeminiUsage = require("../models/GeminiUsage");

const recordGeminiUsage = async (result) => {
  const usage = result?.response?.usageMetadata;
  const date = new Date().toISOString().slice(0, 10);
  try {
    await GeminiUsage.findOneAndUpdate(
      { date },
      {
        $inc: {
          apiCalls: 1,
          promptTokens: Number(usage?.promptTokenCount) || 0,
          candidateTokens: Number(usage?.candidatesTokenCount) || 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    console.error("Could not record Gemini API usage:", error);
  }
};

module.exports = recordGeminiUsage;
