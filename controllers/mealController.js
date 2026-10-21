const Meal = require("../models/Meal");
const User = require("../models/User");
const aiService = require("../services/aiService");
const AppError = require("../utils/appError");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper function to calculate streak
const calculateUserStreak = (lastLoggedDate, currentStreak) => {
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  if (!lastLoggedDate) {
    return { streak: 1, lastLoggedDate: today };
  }

  if (lastLoggedDate === today) {
    return { streak: currentStreak || 1, lastLoggedDate: today };
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("en-CA");

  if (lastLoggedDate === yesterdayStr) {
    return { streak: (currentStreak || 0) + 1, lastLoggedDate: today };
  }

  // Broken streak
  return { streak: 1, lastLoggedDate: today };
};

// 1. AI Text Analysis
const analyzeMealText = async (req, res) => {
  try {
    if (
      req.user?.subscriptionTier !== "pro" &&
      process.env.NODE_ENV === "production"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This feature is only available for Pro Users. Please upgrade to access it.",
      });
    }

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
      generationConfig: { temperature: 0.2 },
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

    if (!rawText || rawText.trim() === "") {
      throw new Error("Gemini returned empty output");
    }

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
    if (
      req.user?.subscriptionTier !== "pro" &&
      process.env.NODE_ENV === "production"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This feature is only available for Pro Users. Please upgrade to access it.",
      });
    }

    const imageBase64 = req.body.imageBase64 || req.body.image;
    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        message: "Image data missing",
      });
    }

    const nutritionData = await aiService.analyzeFoodImage(imageBase64);

    return res.status(200).json({
      success: true,
      status: "success",
      data: nutritionData,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Today's Meals & Summary (Timezone Safe & User Isolated)
const getDailySummary = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toLocaleDateString("en-CA");
    const userId = req.user._id || req.user.id;

    let startOfDay, endOfDay;
    const parts = targetDate.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);

      startOfDay = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
      endOfDay = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
    }

    const meals = await Meal.find({
      $or: [{ userId: userId }, { user: userId }],
      $or: [
        { date: targetDate },
        ...(startOfDay
          ? [{ createdAt: { $gte: startOfDay, $lte: endOfDay } }]
          : []),
      ],
    }).sort({ createdAt: -1 });

    const summary = meals.reduce(
      (acc, meal) => {
        acc.calories += Number(meal.calories) || 0;
        acc.protein += Number(meal.protein) || 0;
        acc.carbs += Number(meal.carbs) || 0;
        acc.fats += Number(meal.fats) || 0;
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

// 4. Get Weekly Summary & Gemini AI Insights (User Isolated & Complete 7 Days)
const getWeeklySummary = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;

    const last7DaysDates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7DaysDates.push(d.toLocaleDateString("en-CA"));
    }

    const weeklyData = await Meal.aggregate([
      {
        $match: {
          $or: [
            { userId: new mongoose.Types.ObjectId(userId) },
            { user: new mongoose.Types.ObjectId(userId) },
          ],
          date: { $in: last7DaysDates },
        },
      },
      {
        $group: {
          _id: "$date",
          calories: { $sum: "$calories" },
          protein: { $sum: "$protein" },
          carbs: { $sum: "$carbs" },
          fats: { $sum: "$fats" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const completeWeeklyData = last7DaysDates.map((dateStr) => {
      const found = weeklyData.find((item) => item._id === dateStr);
      return (
        found || {
          _id: dateStr,
          calories: 0,
          protein: 0,
          carbs: 0,
          fats: 0,
        }
      );
    });

    let aiInsight =
      "Keep tracking your daily meals consistently to achieve your health goals!";
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: "gemini-3.5-flash-lite",
        });
        const prompt = `Analyze this weekly nutrition summary data and provide a concise, encouraging 2-sentence health tip or insight in English: ${JSON.stringify(completeWeeklyData)}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        if (responseText) {
          aiInsight = responseText.trim();
        }
      }
    } catch (aiErr) {
      console.log("Gemini weekly insight fallback used:", aiErr.message);
    }

    res.status(200).json({
      success: true,
      data: {
        weeklyHistory: completeWeeklyData,
        aiInsight,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// 5. Log Meal (With Streak Calculation & Badge Trigger)
const logMeal = async (req, res, next) => {
  try {
    const { name, calories, protein, carbs, fats, date } = req.body;
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return next(
        new AppError("User not authenticated. Please log in again.", 401),
      );
    }

    const userLocalDate = date || new Date().toLocaleDateString("en-CA");

    // Create Meal entry
    const meal = await Meal.create({
      userId: userId,
      user: userId,
      name: name || "Scanned Meal",
      calories: Number(calories) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fats: Number(fats) || 0,
      date: userLocalDate,
    });

    // 🟢 Gamification Logic: Update Streak & Check Exercise Badges
    let updatedStreak = 1;
    let newUnlockedBadge = null;

    const dbUser = await User.findById(userId);
    if (dbUser) {
      const streakResult = calculateUserStreak(
        dbUser.lastLoggedDate,
        dbUser.streakCount,
      );

      dbUser.streakCount = streakResult.streak;
      dbUser.lastLoggedDate = streakResult.lastLoggedDate;
      updatedStreak = streakResult.streak;

      // Badges Check Logic based on Streak Days
      const existingBadgeIds = (dbUser.unlockedBadges || []).map(
        (b) => b.badgeId,
      );

      const checkBadge = (threshold, badgeId) => {
        if (updatedStreak >= threshold && !existingBadgeIds.includes(badgeId)) {
          dbUser.unlockedBadges.push({ badgeId });
          newUnlockedBadge = badgeId;
        }
      };

      checkBadge(3, "ex_3days");
      checkBadge(7, "ex_7days");
      checkBadge(15, "ex_15days");
      checkBadge(30, "ex_30days");

      await dbUser.save();
    }

    res.status(201).json({
      success: true,
      status: "success",
      data: meal,
      streakCount: updatedStreak,
      unlockedBadge: newUnlockedBadge,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Delete Meal (Secured with User Check)
const deleteMeal = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id || req.user.id;

    const meal = await Meal.findOne({
      _id: id,
      $or: [{ userId: userId }, { user: userId }],
    });

    if (!meal) {
      return res.status(404).json({
        success: false,
        message: "Meal not found or unauthorized to delete",
      });
    }

    await Meal.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Meal deleted successfully",
    });
  } catch (error) {
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
    const userId = req.user._id || req.user.id;

    const updatedMeal = await Meal.findOneAndUpdate(
      { _id: id, $or: [{ userId: userId }, { user: userId }] },
      req.body,
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedMeal) {
      return res
        .status(404)
        .json({ success: false, message: "Meal not found or unauthorized" });
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
