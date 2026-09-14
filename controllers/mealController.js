const Meal = require("../models/Meal");
const aiService = require("../services/aiService");
const AppError = require("../utils/appError");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. AI Text Analysis

const analyzeMealText = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Food name required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ success: false, message: "Server API Key Missing" });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash-lite",
      generationConfig: {
        temperature: 0.2,
      },
    });

    const prompt = `You are a nutrition assistant. Calculate standard serving values for: "${text}".
Return ONLY a single valid JSON object with numbers for calories, protein, carbs, and fats. No markdown code blocks, no explanation text.
JSON Schema:
{
  "name": "${text}",
  "calories": 150,
  "protein": 12.5,
  "carbs": 1.0,
  "fats": 10.0
}`;

    const result = await model.generateContent(prompt);
    let rawText = result.response.text();

    console.log("📥 Raw response from Gemini:", rawText); // Debugging ke liye

    if (!rawText || rawText.trim() === "") {
      throw new Error("Gemini returned empty output");
    }

    // Clean backticks or unwanted chars if returned
    rawText = rawText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const nutritionData = JSON.parse(rawText);

    return res.status(200).json({ success: true, data: nutritionData });
  } catch (error) {
    console.error("AI Text Analysis Parse Error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to analyze food text",
    });
  }
};

// 2. AI Vision Scanner
const analyzeMealImage = async (req, res, next) => {
  console.log("📥 AI Scan request received at backend!");
  try {
    const imageBase64 = req.body.imageBase64 || req.body.image;
    const nutritionData = await aiService.analyzeFoodImage(imageBase64);

    res.status(200).json({
      success: true,
      status: "success",
      data: nutritionData,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Today's Meals & Summary
const getDailySummary = async (req, res) => {
  try {
    const { date } = req.query; // Format: "YYYY-MM-DD"
    const targetDate = date ? new Date(date) : new Date();

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const meals = await Meal.find({
      userId: req.user._id || req.user.id,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    });

    const summary = meals.reduce(
      (acc, meal) => {
        acc.calories += meal.calories || 0;
        acc.protein += meal.protein || 0;
        acc.carbs += meal.carbs || 0;
        acc.fats += meal.fats || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fats: 0 },
    );

    return res.status(200).json({
      success: true,
      data: { summary, meals },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Get Weekly Summary
const getWeeklySummary = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const weeklyData = await Meal.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          calories: { $sum: "$calories" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      success: true,
      data: weeklyData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 5. Log Meal
const logMeal = async (req, res, next) => {
  try {
    const { name, calories, protein, carbs, fats } = req.body;
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return next(
        new AppError("User not authenticated. Please log in again.", 401),
      );
    }

    const meal = await Meal.create({
      userId: userId,
      user: userId,
      name: name || "Scanned Meal",
      calories: Number(calories) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fats: Number(fats) || 0,
    });

    res.status(201).json({
      success: true,
      status: "success",
      data: meal,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Delete Meal
const deleteMeal = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("👉 Backend received delete ID:", id);

    const meal = await Meal.findById(id);

    if (!meal) {
      console.log("❌ Meal DB mein nahi mili!");
      return res.status(404).json({
        success: false,
        message: "Meal not found in database",
      });
    }

    await Meal.findByIdAndDelete(id);

    console.log("✅ Meal successfully deleted from MongoDB!");
    return res.status(200).json({
      success: true,
      message: "Meal deleted successfully",
    });
  } catch (error) {
    console.error("🔥 Delete Error:", error.message);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 7. Update Meal
const updateMeal = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedMeal = await Meal.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedMeal) {
      return res
        .status(404)
        .json({ success: false, message: "Meal not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Meal updated successfully",
      data: updatedMeal,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  analyzeMealText,
  analyzeMealImage,
  scanMealImage: analyzeMealImage,
  getDailySummary,
  getWeeklySummary,
  logMeal,
  deleteMeal,
  updateMeal,
};
