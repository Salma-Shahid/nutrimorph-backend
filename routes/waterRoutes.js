const express = require("express");
const router = express.Router();
const Water = require("../models/Water");
const User = require("../models/User"); //  User model imported for badge unlocking
const { protect } = require("../middlewares/authMiddleware");

const isValidDate = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

// 1. GET Water Intake
router.get("/", protect, async (req, res) => {
  try {
    const { date } = req.query;
    if (!isValidDate(date)) {
      return res.status(400).json({
        success: false,
        message: "A date in YYYY-MM-DD format is required.",
      });
    }
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
    const count = Number(glasses);
    if (
      !isValidDate(date) ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "Provide a valid date and a glass count between 0 and 100.",
      });
    }
    const userId = req.user._id || req.user.id;

    // 1. Update Water Record in DB
    const waterRecord = await Water.findOneAndUpdate(
      { userId, date },
      {
        $set: { glasses: count, email: req.user.email },
        $setOnInsert: { userId, date },
      },
      { upsert: true, new: true, runValidators: true },
    );

    // 2.  Water Milestones Badge Checking Logic
    let user = await User.findById(userId);
    let newlyUnlocked = [];

    if (user) {
      const totalMl = count * 250;
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
        // Mark the array as modified so Mongoose persists the changes.
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
