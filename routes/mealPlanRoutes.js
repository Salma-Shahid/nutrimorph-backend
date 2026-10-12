const express = require("express");
const router = express.Router();
const mealPlanController = require("../controllers/mealPlanController");
const { protect } = require("../middlewares/authMiddleware");
const { checkPro } = require("../middlewares/checkPro");
const { aiLimiter } = require("../middlewares/rateLimiter");

// 1. Generate 7-Day Custom Meal Plan (Protected + Pro Check + Rate Limiter)
router.post(
  "/generate",
  protect,
  checkPro,
  aiLimiter,
  mealPlanController.generateMealPlan,
);

// 2. Get Active Meal Plan
router.get("/active", protect, mealPlanController.getActiveMealPlan);

module.exports = router;
