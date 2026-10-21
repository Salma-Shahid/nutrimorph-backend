const express = require("express");
const router = express.Router();
const Water = require("../models/Water");
const User = require("../models/User"); // 🟢 User model imported for badge unlocking
const { protect } = require("../middlewares/authMiddleware");

// 1. GET Water Intake
router.get("/", protect, async (req, res) => {
  try {
    const { date } = req.query;
    const userId = req.user._id || req.user.id;

    let waterRecord = await Water.findOne({ userId, date });

    res.status(200).json({
      success: true,
      data: waterRecord || { glasses: 0, date },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. UPDATE/SAVE Water Intake & Unlock Water Badges
router.post("/", protect, async (req, res) => {
  try {
    const { date, glasses } = req.body;
    const userId = req.user._id || req.user.id;

    // 1. Update Water Record in DB
    const waterRecord = await Water.findOneAndUpdate(
      { userId, date },
      { glasses },
      { upsert: true, returnDocument: "after" },
    );

    // 2. 💧 Water Milestones Badge Checking Logic
    let user = await User.findById(userId);
    let newlyUnlocked = [];

    if (user) {
      const totalMl = (glasses || 0) * 250; // 1 glass = 250ml
      const waterMilestones = [
        { ml: 1500, id: "water_1.5l" },
        { ml: 2500, id: "water_2.5l" },
        { ml: 3500, id: "water_3.5l" },
        { ml: 4000, id: "water_4l" },
      ];

      if (!user.unlockedBadges) {
        user.unlockedBadges = [];
      }

      waterMilestones.forEach((milestone) => {
        const alreadyUnlocked = user.unlockedBadges.some(
          (b) => (typeof b === "string" ? b : b.badgeId) === milestone.id,
        );

        if (totalMl >= milestone.ml && !alreadyUnlocked) {
          user.unlockedBadges.push({
            badgeId: milestone.id,
            unlockedAt: new Date(),
          });
          newlyUnlocked.push(milestone.id);
        }
      });

      if (newlyUnlocked.length > 0) {
        // Mongoose Schema Array Change Track ensure karne ke liye
        user.markModified("unlockedBadges");
        await user.save();
      }
    }

    res.status(200).json({
      success: true,
      data: waterRecord,
      unlockedBadges: user ? user.unlockedBadges : [],
      newlyUnlockedBadges: newlyUnlocked,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
