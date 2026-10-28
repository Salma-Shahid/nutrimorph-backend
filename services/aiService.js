const { GoogleGenerativeAI } = require("@google/generative-ai");
const AppError = require("../utils/appError");
const { callGeminiWithRetry } = require("../utils/aiHelper");

class AIService {
  async analyzeFoodImage(imageBase64) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new AppError("GEMINI_API_KEY missing in backend .env file", 500);
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      // 🟢 Added temperature: 0.8 for creative and varied AI outputs
      const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash-lite",
        generationConfig: { temperature: 0.8 },
      });

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

      const prompt = `
        Analyze this food image and estimate the nutritional information.
        Return ONLY a raw JSON object with no markdown syntax in this exact format:
        {
          "name": "Food item name",
          "calories": number,
          "protein": number,
          "carbs": number,
          "fats": number
        }
      `;

      const imagePart = {
        inlineData: {
          data: cleanBase64,
          mimeType: "image/jpeg",
        },
      };

      const result = await callGeminiWithRetry(async () => {
        return await model.generateContent([prompt, imagePart]);
      });

      const rawText = result.response.text().trim();

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new AppError("Invalid JSON returned by AI engine", 502);
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error("❌ AIService Error Detail:", error.message || error);
      throw new AppError(
        error.message || "AI engine failed to process image.",
        502,
      );
    }
  }

  // 🟢 New dynamic recovery guidance method to avoid repeating static answers
  async generateRecoveryGuidance(deviationAmount, latestMealType) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      return "Keep your next meal light with leafy greens and lean protein.";

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash-lite",
        generationConfig: { temperature: 0.85 }, // High temperature for maximum variety
      });

      const prompt = `The user has a calorie deviation of ${deviationAmount} kcal and their recent meal category was ${latestMealType}. 
      Give a fresh, unique, and encouraging 2-sentence natural health rescue tip in English. Never use the exact same phrasing twice; vary the suggestion creatively.`;

      const result = await callGeminiWithRetry(async () => {
        return await model.generateContent(prompt);
      });

      return result.response.text().trim();
    } catch (err) {
      console.log("Recovery guidance AI fallback used:", err.message);
      return "Balance your upcoming meals with high-fiber veggies and plenty of water to stay on track.";
    }
  }
}

module.exports = new AIService();
