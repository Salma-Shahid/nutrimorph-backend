const express = require("express");
const router = express.Router();
const SavedMeal = require("../models/SavedMeal");
const { protect } = require("../middlewares/authMiddleware");

// 1. Get all saved meals for logged-in user
router.get("/", protect, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const meals = await SavedMeal.find({ userId }).sort({ createdAt: -1 });
    res.json({ success: true, data: meals });
  } catch (error) {
    console.error("Fetch saved meals error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Save a new recipe / meal (Bulletproof 400 fix)
router.post("/", protect, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Not authorized, user ID missing" });
    }

    // Safe extraction with fallbacks
    const name = req.body?.name;
    const calories = req.body?.calories || 0;
    const protein = req.body?.protein || 0;
    const carbs = req.body?.carbs || 0;
    const fats = req.body?.fats || 0;

    if (!name || typeof name !== "string" || name.trim() === "") {
      return res
        .status(400)
        .json({ success: false, message: "Valid meal name is required" });
    }

    const trimmedName = name.trim();

    // Check if recipe already exists for this user
    let existingMeal = await SavedMeal.findOne({ userId, name: trimmedName });
    if (existingMeal) {
      return res.status(200).json({
        success: true,
        data: existingMeal,
        message: "Recipe already saved",
      });
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
    res.status(400).json({ success: false, message: error.message });
  }
});

// 3. Delete saved meal by ID
router.delete("/:id", protect, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const recipeId = req.params.id;

    const deleted = await SavedMeal.findOneAndDelete({ _id: recipeId, userId });
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Recipe not found" });
    }

    res.json({ success: true, message: "Recipe deleted successfully" });
  } catch (error) {
    console.error("Delete saved meal error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
