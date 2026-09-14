const express = require("express");
const router = express.Router();
const Water = require("../models/Water");
// Corrected Middleware Import
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

// 2. UPDATE/SAVE Water Intake
router.post("/", protect, async (req, res) => {
  try {
    const { date, glasses } = req.body;
    const userId = req.user._id || req.user.id;

    const waterRecord = await Water.findOneAndUpdate(
      { userId, date },
      { glasses },
      { upsert: true, returnDocument: "after" },
    );

    res.status(200).json({
      success: true,
      data: waterRecord,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
