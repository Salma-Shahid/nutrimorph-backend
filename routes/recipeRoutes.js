const express = require("express");
const router = express.Router();
const {
  getCategorizedRecipes,
  addRecipeToDiary,
} = require("../controllers/recipeController");
const { protect } = require("../middlewares/authMiddleware");

// @desc    Get all recipes or filter by category
// @route   GET /api/recipes
// @access  Private
router.get("/", protect, getCategorizedRecipes);

// @desc    Add recipe to user daily food log / diary
// @route   POST /api/recipes/add-to-diary
// @access  Private
router.post("/add-to-diary", protect, addRecipeToDiary);

module.exports = router;
