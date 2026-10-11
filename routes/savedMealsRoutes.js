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
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authorized" });
    }

    const { name, calories, protein, carbs, fats } = req.body;
    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Meal name is required" });
    }

    const trimmedName = name.trim();

    // Prevent duplicate entries for the same user
    let existingMeal = await SavedMeal.findOne({ userId, name: trimmedName });
    if (existingMeal) {
      return res.status(200).json({ success: true, data: existingMeal });
    }

    const newMeal = new SavedMeal({
      userId,
      name: trimmedName,
      calories: Number(calories) || 0,
      protein: Number(protein) || 0,
      carbs: Number(carbs) || 0,
      fats: Number(fats) || 0,
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
