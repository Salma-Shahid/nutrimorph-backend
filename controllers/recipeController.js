const SavedMeal = require("../models/SavedMeal");
const Meal = require("../models/Meal");
const User = require("../models/User");

// Helper function for user streak
const calculateUserStreak = (lastLoggedDate, currentStreak) => {
  const today = new Date().toLocaleDateString("en-CA");
  if (!lastLoggedDate) return { streak: 1, lastLoggedDate: today };
  if (lastLoggedDate === today)
    return { streak: currentStreak || 1, lastLoggedDate: today };

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("en-CA");

  if (lastLoggedDate === yesterdayStr) {
    return { streak: (currentStreak || 0) + 1, lastLoggedDate: today };
  }
  return { streak: 1, lastLoggedDate: today };
};

// 1. Get Recipes by Category or All
const getCategorizedRecipes = async (req, res) => {
  try {
    const { category } = req.query;

    // Sirf global / official recipes fetch hongi, personal saved meals nahi
    let query = {
      isGlobal: true,
    };

    if (category && category !== "All") {
      query.category = category;
    }

    const recipes = await SavedMeal.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: recipes.length,
      recipes: recipes,
      data: recipes,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Direct "Add To Diary" Action (Recipe to Daily Meal Sync with Streak Update)
const addRecipeToDiary = async (req, res) => {
  try {
    const { recipeId, date } = req.body;
    const userId = req.user?._id || req.user?.id;

    const recipe = await SavedMeal.findById(recipeId);
    if (!recipe) {
      return res
        .status(404)
        .json({ success: false, message: "Recipe not found" });
    }

    const targetDate = date || new Date().toLocaleDateString("en-CA");

    // 1. Create a new Meal entry from Recipe
    const newMeal = await Meal.create({
      userId,
      user: userId,
      name: recipe.name || recipe.title,
      calories: recipe.calories || 0,
      protein: recipe.protein || 0,
      carbs: recipe.carbs || 0,
      fats: recipe.fats || 0,
      date: targetDate,
    });

    // 2. Update Streak & Badges
    let updatedStreak = 1;
    const dbUser = await User.findById(userId);
    if (dbUser) {
      const streakResult = calculateUserStreak(
        dbUser.lastLoggedDate,
        dbUser.streakCount,
      );
      dbUser.streakCount = streakResult.streak;
      dbUser.lastLoggedDate = streakResult.lastLoggedDate;
      updatedStreak = streakResult.streak;
      await dbUser.save();
    }

    res.status(201).json({
      success: true,
      message: `${recipe.name || recipe.title} added to your Diary successfully!`,
      data: newMeal,
      streakCount: updatedStreak,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCategorizedRecipes,
  addRecipeToDiary,
};
