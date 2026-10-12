const MealPlan = require("../models/MealPlan");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Generate 7-Day Custom Meal Plan using Gemini AI
const generateMealPlan = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const { goal, dietType, targetCalories } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ success: false, message: "Server API Key Missing" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash-lite",
      generationConfig: { temperature: 0.3 },
    });

    const prompt = `You are a professional nutritionist. Generate a 7-day custom meal plan for a user with the following goals:
- Goal: ${goal || "weight_loss"}
- Diet Preference: ${dietType || "Desi / Pakistani Standard"}
- Target Daily Calories: ${targetCalories || 2000} kcal

Return ONLY a single valid JSON object with no markdown code blocks, no explanation text. Ensure all 7 days (Monday to Sunday) are included in the days array.
JSON Schema:
{
  "goal": "${goal || "weight_loss"}",
  "dietType": "${dietType || "Desi / Pakistani Standard"}",
  "targetCalories": ${targetCalories || 2000},
  "days": [
    {
      "day": "Monday",
      "meals": {
        "breakfast": { "name": "...", "calories": 400, "protein": 20, "carbs": 50, "fats": 10 },
        "lunch": { "name": "...", "calories": 600, "protein": 30, "carbs": 70, "fats": 15 },
        "dinner": { "name": "...", "calories": 500, "protein": 35, "carbs": 40, "fats": 12 },
        "snack": { "name": "...", "calories": 200, "protein": 10, "carbs": 20, "fats": 5 }
      }
    }
  ]
}`;

    const result = await model.generateContent(prompt);
    let rawText = result.response.text();

    if (!rawText || rawText.trim() === "") {
      throw new Error("Gemini returned empty output");
    }

    rawText = rawText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const planData = JSON.parse(rawText);

    // Deactivate previous active plans
    await MealPlan.updateMany({ userId }, { isActive: false });

    // Save new plan to database
    const newMealPlan = await MealPlan.create({
      userId,
      goal: planData.goal || goal || "weight_loss",
      dietType: planData.dietType || dietType || "Desi / Pakistani Standard",
      targetCalories: planData.targetCalories || targetCalories || 2000,
      days: planData.days,
      isActive: true,
    });

    return res.status(200).json({
      success: true,
      message: "Meal plan generated successfully",
      data: newMealPlan,
    });
  } catch (error) {
    console.error("Meal Plan Generation Error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate meal plan",
    });
  }
};

// Get Active Meal Plan
const getActiveMealPlan = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const plan = await MealPlan.findOne({ userId, isActive: true });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "No active meal plan found",
      });
    }

    return res.status(200).json({
      success: true,
      data: plan,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  generateMealPlan,
  getActiveMealPlan,
};
