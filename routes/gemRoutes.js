const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  getGemStatus,
  claimAdReward,
  reviveStreak,
} = require("../controllers/gemController");

router.get("/", protect, getGemStatus);
router.post("/ad-reward", protect, claimAdReward);
router.post("/revive", protect, reviveStreak);

module.exports = router;
