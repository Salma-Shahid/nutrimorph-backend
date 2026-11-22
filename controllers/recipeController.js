const SavedMeal = require("../models/SavedMeal");
const Meal = require("../models/Meal");
const User = require("../models/User");
const { updateStreak } = require("../utils/streak");

// Helper function for user streak
// 1. Get Recipes by Category or All
const getCategorizedRecipes = async (req, res) => {
  try {
    const { category, cuisine, q } = req.query;

    // Fetch global recipes only, excluding personal saved meals.
    let query = {
      isGlobal: true,
    };

    if (category && category !== "All") {
      query.category = category;
    }
    if (cuisine && cuisine !== "All") {
      query.cuisine =
        cuisine.toLowerCase() === "arabic"
          ? { $in: [/^arabic$/i, /^middle eastern$/i] }
          : new RegExp(
              String(cuisine).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "i",
            );
    }
    if (typeof q === "string" && q.trim()) {
      const search = q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: search, $options: "i" };
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

    const recipe = await SavedMeal.findOne({
      _id: recipeId,
      $or: [{ isGlobal: true }, { userId }],
    });
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
      email: req.user.email,
      name: recipe.name || recipe.title,
      calories: recipe.calories || 0,
      protein: recipe.protein || 0,
      carbs: recipe.carbs || 0,
      fats: recipe.fats || 0,
      servingSize: recipe.servingSize || "1 serving",
      date: targetDate,
    });

    // 2. Update Streak & Badges
    let updatedStreak = 1;
    const dbUser = await User.findById(userId);
    if (dbUser) {
      const streakResult = updateStreak(
        dbUser.lastLoggedDate,
        dbUser.streakCount,
        targetDate,
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
