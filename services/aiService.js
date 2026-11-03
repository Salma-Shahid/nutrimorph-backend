const { GoogleGenerativeAI } = require("@google/generative-ai");
const AppError = require("../utils/appError");
const { callGeminiWithRetry } = require("../utils/aiHelper");
const { GEMINI_MODEL } = require("../config/ai");

class AIService {
  async analyzeFoodImage(imageBase64) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new AppError("GEMINI_API_KEY missing in backend .env file", 500);
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { temperature: 0.2 },
      });

      const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

      const prompt = `
        Analyze this food image and estimate the nutritional information.
        Write the food name and all text in professional Standard English.
        Do not use Urdu, Roman Urdu, or mixed-language phrases.
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
      console.error(" AIService Error Detail:", error.message || error);
      throw new AppError(
        error.message || "AI engine failed to process image.",
        502,
      );
    }
  }

  // Return supportive, non-punitive recovery guidance in English.
  async generateRecoveryGuidance(deviationAmount, latestMealType) {
    const apiKey = process.env.GEMINI_API_KEY;
    const overage = Math.max(0, Math.floor(Number(deviationAmount) || 0));
    const fallback =
      overage > 0
        ? `You have exceeded your calorie goal by ${overage} kcal. Do not skip meals or overexercise to compensate. Return to your usual balanced routine tomorrow.`
        : "You are within your calorie goal. Continue with balanced meals and consistent tracking.";
    if (!apiKey) return fallback;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { temperature: 0.2 },
      });

      const prompt = `Write one supportive, professional Standard English response. The user exceeded their daily calorie goal by ${overage} kcal. Their most recent meal category was ${latestMealType || "unspecified"}. State the overage clearly, discourage meal skipping or compensatory exercise, and encourage returning to their usual balanced routine tomorrow. Do not use Urdu or Roman Urdu.`;

      const result = await callGeminiWithRetry(async () => {
        return await model.generateContent(prompt);
      });

      return result.response.text().trim();
    } catch (err) {
      console.error("Recovery guidance generation failed:", err.message);
      return fallback;
    }
  }
}

module.exports = new AIService();
