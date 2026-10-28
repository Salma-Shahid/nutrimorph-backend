const express = require("express");
const router = express.Router();
const exerciseController = require("../controllers/exerciseController");
const { protect } = require("../middlewares/authMiddleware");

router.get("/", protect, exerciseController.getExerciseData);
router.post("/", protect, exerciseController.logExerciseOrSteps);

module.exports = router;
