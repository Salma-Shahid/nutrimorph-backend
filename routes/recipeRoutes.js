const express = require("express");
const router = express.Router();
const Recipe = require("../models/Recipe");
const { protect } = require("../middlewares/authMiddleware");

// @desc    Get all recipes or filter by category
// @route   GET /api/recipes
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const { category } = req.query;
    let query = {};
    if (category && category !== "All") {
      query.category = category;
    }
    const recipes = await Recipe.find(query);
    res.status(200).json({ success: true, recipes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Add recipe to user daily food log / diary
// @route   POST /api/recipes/add-to-diary
// @access  Private
router.post("/add-to-diary", protect, async (req, res) => {
  try {
    const { recipeId, mealType } = req.body; // mealType: Breakfast, Lunch, Dinner, Snack
    const recipe = await Recipe.findById(recipeId);

    if (!recipe) {
      return res
        .status(404)
        .json({ success: false, message: "Recipe not found" });
    }

    // Yahan aap user ke daily log/diary collection mein recipe ke macros add kar sakte hain
    // Misal ke taur par user ke consumed calories aur macros update karna

    res.status(200).json({
      success: true,
      message: `${recipe.title} added to your ${mealType || "Diary"} successfully!`,
      consumedNutrition: {
        calories: recipe.calories,
        protein: recipe.protein,
        carbs: recipe.carbs,
        fats: recipe.fats,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
