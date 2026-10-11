const express = require("express");
const router = express.Router();
const SavedMeal = require("../models/SavedMeal");
const { protect } = require("../middlewares/authMiddleware");

// 1. Get all saved meals for the logged-in user
router.get("/", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const meals = await SavedMeal.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, data: meals });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Save a new recipe / meal
router.post("/", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // Safely extract from req.body (handles missing body gracefully)
    const name = req.body?.name;
    const calories = req.body?.calories || 0;
    const protein = req.body?.protein || 0;
    const carbs = req.body?.carbs || 0;
    const fats = req.body?.fats || 0;

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Meal name is required" });
    }

    const trimmedName = name.trim();

    // Check if recipe already exists for this user
    let existingMeal = await SavedMeal.findOne({ userId, name: trimmedName });
    if (existingMeal) {
      return res
        .status(200)
        .json({
          success: true,
          data: existingMeal,
          message: "Recipe already saved",
        });
    }

    const newMeal = new SavedMeal({
      userId,
      name: trimmedName,
      calories: Number(calories),
      protein: Number(protein),
      carbs: Number(carbs),
      fats: Number(fats),
    });

    await newMeal.save();
    res.status(201).json({ success: true, data: newMeal });
  } catch (error) {
    console.error("Save recipe error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Delete a saved recipe
router.delete("/:id", protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const mealId = req.params.id;

    const deletedMeal = await SavedMeal.findOneAndDelete({
      _id: mealId,
      userId,
    });

    if (!deletedMeal) {
      return res
        .status(404)
        .json({ success: false, message: "Saved recipe not found" });
    }

    res.json({ success: true, message: "Recipe deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
