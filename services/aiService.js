const { GoogleGenerativeAI } = require("@google/generative-ai");
const AppError = require("../utils/appError");
const { callGeminiWithRetry } = require("../utils/aiHelper");
const { GEMINI_MODEL } = require("../config/ai");
const recordGeminiUsage = require("../utils/recordGeminiUsage");
const validateNutritionData = require("../utils/validateNutritionData");

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
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      });

      const dataUrlMatch = imageBase64.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/,
      );
      const cleanBase64 = dataUrlMatch
        ? dataUrlMatch[2]
        : imageBase64.replace(/^data:image\/[^;]+;base64,/, "");
      const mimeType = dataUrlMatch?.[1] || "image/jpeg";

      const prompt = `
        Analyze the visible edible food and estimate nutrition for one complete visible serving.
        If the portion size cannot be estimated reliably, use 100 g and state that assumption.
        Write the food name and all text in professional Standard English.
        Do not use Urdu, Roman Urdu, or mixed-language phrases.
        Return one JSON object. Calories must be kcal; protein, carbohydrates, and fats must be grams.
        Do not invent precision; round calories to a whole number and macros to one decimal.
        {
          "name": "Food item name",
          "servingSize": "Estimated serving description, or 100 g",
          "calories": number,
          "protein": number,
          "carbs": number,
          "fats": number
        }
      `;

      const imagePart = {
        inlineData: {
          data: cleanBase64,
          mimeType,
        },
      };

      const result = await callGeminiWithRetry(async () => {
        return await model.generateContent([prompt, imagePart]);
      });
      await recordGeminiUsage(result);

      const rawText = result.response.text().trim();

      return validateNutritionData(rawText);
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
