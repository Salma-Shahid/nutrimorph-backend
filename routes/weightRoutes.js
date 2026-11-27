const express = require("express");
const router = express.Router();
const WeightEntry = require("../models/WeightEntry");
const User = require("../models/User");
const { protect } = require("../middlewares/authMiddleware");

const getBmiCategory = (bmi) => {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Normal";
  if (bmi < 30) return "Overweight";
  return "Obese";
};

router.get("/", protect, async (req, res) => {
  try {
    // Full account history (bounded) so trends reflect every weigh-in, not
    // just the last few. `?limit=` may lower or raise it up to 1000.
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 1000)
      : 365;
    const [entries, total] = await Promise.all([
      WeightEntry.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select("weight createdAt")
        .lean(),
      WeightEntry.countDocuments({ userId: req.user._id }),
    ]);
    return res.json({ success: true, data: entries.reverse(), total });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/", protect, async (req, res) => {
  const weight = Number(req.body?.weight);
  if (!Number.isFinite(weight) || weight < 15 || weight > 500) {
    return res.status(400).json({
      success: false,
      message: "Weight must be a valid kilogram value between 15 and 500.",
    });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.weight = weight;
    if (Number(user.height) > 0) {
      user.bmi = Number(
        (weight / Math.pow(Number(user.height) / 100, 2)).toFixed(1),
      );
      user.bmiCategory = getBmiCategory(user.bmi);
    }
    await user.save();

    const entry = await WeightEntry.create({
      userId: user._id,
      email: user.email,
      weight,
    });

    return res.status(201).json({
      success: true,
      data: entry,
      user: {
        weight: user.weight,
        bmi: user.bmi,
        bmiCategory: user.bmiCategory,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
