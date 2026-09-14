const express = require("express");
const router = express.Router();
const mealController = require("../controllers/mealController");
const validateRequest = require("../middlewares/validateRequest");
const { analyzeMealSchema } = require("../validators/mealValidator");
const { aiLimiter } = require("../middlewares/rateLimiter");
const { protect } = require("../middlewares/authMiddleware");
const { checkPro } = require("../middlewares/checkPro"); // 👈 Pro Middleware Import

// 1. Daily & Weekly Summary GET Routes
router.get("/summary", protect, mealController.getDailySummary);
router.get("/daily-summary", protect, mealController.getDailySummary);
router.get("/today", protect, mealController.getDailySummary);
router.get("/", protect, mealController.getDailySummary);
router.get("/weekly-summary", protect, mealController.getWeeklySummary);

// 2. AI Scan Routes (Protected + Pro Check + Rate Limiter)
router.post(
  "/scan",
  protect,
  checkPro,
  aiLimiter,
  validateRequest(analyzeMealSchema),
  mealController.analyzeMealImage,
);
router.post(
  "/scan-ai",
  protect,
  checkPro,
  aiLimiter,
  validateRequest(analyzeMealSchema),
  mealController.analyzeMealImage,
);

// 3. AI Text Parsing Route (Protected + Pro Check)
router.post("/parse-text", protect, checkPro, mealController.analyzeMealText);

// 4. Log Meal Routes (Free + Pro Both)
router.post("/log", protect, mealController.logMeal);
router.post("/", protect, mealController.logMeal);

// 5. Edit / Update Meal Route
router.put("/:id", protect, mealController.updateMeal);

// 6. Delete Meal Route
router.delete("/:id", protect, mealController.deleteMeal);

module.exports = router;
