const { GoogleGenerativeAI } = require("@google/generative-ai");
const AppError = require("../utils/appError");

class AIService {
  async analyzeFoodImage(imageBase64) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new AppError("GEMINI_API_KEY missing in backend .env file", 500);
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash-lite",
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

      const result = await model.generateContent([prompt, imagePart]);
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
}

module.exports = new AIService();
