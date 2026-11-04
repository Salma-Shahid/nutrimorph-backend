const MealPlan = require("../models/MealPlan");
const User = require("../models/User");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require("zod");
const { callGeminiWithRetry } = require("../utils/aiHelper"); //  Retry Helper Import
const { GEMINI_MODEL } = require("../config/ai");
const isProUser = require("../utils/isProUser");
const normalizeSubscription = require("../utils/normalizeSubscription");

// 1. Zod Schema Definitions for AI Meal Plan Output Validation
const MealItemSchema = z.object({
  name: z.string(),
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fats: z.number(),
});

const DayPlanSchema = z.object({
  day: z.string(),
  meals: z.object({
    breakfast: MealItemSchema,
    lunch: MealItemSchema,
    dinner: MealItemSchema,
    snack: MealItemSchema,
  }),
});

const MealPlanResponseSchema = z.object({
  goal: z.string(),
  dietType: z.string(),
  targetCalories: z.number(),
  duration: z.number().optional(),
  days: z.array(DayPlanSchema),
});

// Generate Custom Meal Plan using Gemini AI (Pro Users Only + Zod Validation)
const generateMealPlan = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    // Fetch fresh user data to verify Subscription Tier
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found in the system.",
      });
    }

    await normalizeSubscription(user);
    const { goal, dietType, targetCalories, duration = 3 } = req.body;
    const allowedDurations = [3, 5, 7, 15, 30];
    if (!Number.isInteger(Number(duration)) || !allowedDurations.includes(Number(duration))) {
      return res.status(400).json({
        success: false,
        message: "Choose a supported meal plan duration.",
      });
    }

    if (!isProUser(user) && Number(duration) !== 3) {
      return res.status(403).json({
        success: false,
        code: "TRIAL_REQUIRED",
        message:
          "Free accounts can generate 3-day meal plans. Start a 3-day free trial to unlock longer plans.",
      });
    }
    const planDuration = Number(duration);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ success: false, message: "Server API Key Missing" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { temperature: 0.3 },
    });

    const prompt = `You are a professional nutritionist. Generate a personalized ${planDuration}-day custom meal plan for a user with the following goals:
- Goal: ${goal || "weight_loss"}
- Diet Preference: ${dietType || "Desi / Pakistani Standard"}
- Target Daily Calories: ${targetCalories || 2000} kcal
- Plan Duration: Exactly ${planDuration} days

Return ONLY a single valid JSON object with no markdown code blocks, no explanation text.
Write every title, ingredient, and instruction in professional Standard English. Do not use Urdu, Roman Urdu, or mixed-language phrases. Keep culturally specific dish names that are proper nouns, but describe their ingredients and preparation in English.
Ensure the "days" array contains exactly ${planDuration} day objects (labeled "Day 1", "Day 2", up to "Day ${planDuration}").

JSON Schema:
{
  "goal": "${goal || "weight_loss"}",
  "dietType": "${dietType || "Desi / Pakistani Standard"}",
  "targetCalories": ${targetCalories || 2000},
  "duration": ${planDuration},
  "days": [
    {
      "day": "Day 1",
      "meals": {
        "breakfast": { "name": "...", "calories": 400, "protein": 20, "carbs": 50, "fats": 10 },
        "lunch": { "name": "...", "calories": 600, "protein": 30, "carbs": 70, "fats": 15 },
        "dinner": { "name": "...", "calories": 500, "protein": 35, "carbs": 40, "fats": 12 },
        "snack": { "name": "...", "calories": 200, "protein": 10, "carbs": 20, "fats": 5 }
      }
    }
  ]
}`;

    //  Call Gemini with Exponential Backoff Retry Wrapper
    const result = await callGeminiWithRetry(async () => {
      return await model.generateContent(prompt);
    });

    let rawText = result.response.text();

    if (!rawText || rawText.trim() === "") {
      throw new Error("Gemini returned empty output");
    }

    rawText = rawText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    let parsedJSON;
    try {
      parsedJSON = JSON.parse(rawText);
    } catch (parseErr) {
      throw new Error("AI returned malformed JSON format");
    }

    // Validate parsed output against Zod Schema
    const validationResult = MealPlanResponseSchema.safeParse(parsedJSON);
    if (!validationResult.success) {
      console.error(
        "Zod Schema Validation Failed:",
        validationResult.error.format(),
      );
      return res.status(400).json({
        success: false,
        message:
          "AI generated an invalid meal plan structure. Please try generating again.",
      });
    }

    const validatedData = validationResult.data;

    // Deactivate previous active plans
    await MealPlan.updateMany({ userId }, { isActive: false });

    // Save validated plan to database
    const newMealPlan = await MealPlan.create({
      userId,
      goal: validatedData.goal || goal || "weight_loss",
      dietType:
        validatedData.dietType || dietType || "Desi / Pakistani Standard",
      targetCalories: validatedData.targetCalories || targetCalories || 2000,
      days: validatedData.days,
      isActive: true,
    });

    return res.status(200).json({
      success: true,
      message: `${planDuration}-Day meal plan generated and validated successfully`,
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
