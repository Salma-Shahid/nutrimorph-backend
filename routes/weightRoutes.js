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
    const entries = await WeightEntry.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(90)
      .lean();
    return res.json({ success: true, data: entries.reverse() });
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
