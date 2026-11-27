const express = require("express");
const router = express.Router();
const mealController = require("../controllers/mealController");
const validateRequest = require("../middlewares/validateRequest");
const { analyzeMealSchema } = require("../validators/mealValidator");
const { aiLimiter } = require("../middlewares/rateLimiter");
const { protect } = require("../middlewares/authMiddleware");

// 1. Daily & Weekly Summary GET Routes
router.get("/summary", protect, mealController.getDailySummary);
router.get("/daily-summary", protect, mealController.getDailySummary);
router.get("/today", protect, mealController.getDailySummary);
router.get("/", protect, mealController.getDailySummary);
router.get("/weekly-summary", protect, mealController.getWeeklySummary);
router.get("/recovery-guidance", protect, mealController.getRecoveryGuidance);

// 2. AI Scan Routes
router.post(
  "/scan-allowance",
  protect,
  mealController.reserveMealScanAllowance,
);
router.post(
  "/scan",
  protect,
  aiLimiter,
  validateRequest(analyzeMealSchema),
  mealController.analyzeMealImage,
);
router.post(
  "/scan-ai",
  protect,
  aiLimiter,
  validateRequest(analyzeMealSchema),
  mealController.analyzeMealImage,
);

// 3. AI Text Parsing Route
// Pro-only, except the barcode zero-macro fallback (`source: "barcode"`), which
// spends a free user's daily scan. Gating is enforced in analyzeMealText.
router.post("/parse-text", protect, mealController.analyzeMealText);
router.post(
  "/recovery-guidance",
  protect,
  aiLimiter,
  mealController.getRecoveryGuidance,
);

// 4. Log Meal Routes
router.post("/log", protect, mealController.logMeal);
router.post("/", protect, mealController.logMeal);

// 5. Edit / Update Meal Route
router.put("/:id", protect, mealController.updateMeal);

// 6. Delete Meal Route
router.delete("/:id", protect, mealController.deleteMeal);

module.exports = router;
