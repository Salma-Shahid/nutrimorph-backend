const User = require("../models/User");

// Water intake update karne aur badges check karne ka controller
const updateWaterIntake = async (req, res) => {
  try {
    const { waterIntake, date } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Water intake update logic (Aap apne existing water schema ke mutabiq adjust kar sakti hain)
    user.waterIntake = waterIntake;

    // 💧 Water Badges Check Logic
    const totalMl = (waterIntake || 0) * 250; // 1 glass = 250ml
    let newlyUnlocked = [];

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

    await user.save();

    res.status(200).json({
      success: true,
      message: "Water intake updated successfully",
      waterIntake: user.waterIntake,
      unlockedBadges: user.unlockedBadges,
      newlyUnlocked,
    });
  } catch (error) {
    console.error("Water update error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  updateWaterIntake,
};
