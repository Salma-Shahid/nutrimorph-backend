const Exercise = require("../models/ExerciseModel");
const User = require("../models/User"); // 🟢 User model import kiya
const AppError = require("../utils/appError");

// Get Daily Exercise & Steps Summary
const getExerciseData = async (req, res, next) => {
  try {
    const { date } = req.query;
    const userId = req.user._id;

    let record = await Exercise.findOne({ user: userId, date });
    if (!record) {
      record = { steps: 0, caloriesBurned: 0, exerciseName: "" };
    }

    res.status(200).json({
      success: true,
      data: record,
    });
  } catch (error) {
    next(error);
  }
};

// Log Exercise or Update Steps with Auto Streak & Badges Evaluator
const logExerciseOrSteps = async (req, res, next) => {
  try {
    const { date, steps, caloriesBurned, exerciseName } = req.body;
    const userId = req.user._id;

    let record = await Exercise.findOne({ user: userId, date });

    if (record) {
      if (steps !== undefined) record.steps += Number(steps);
      if (caloriesBurned !== undefined)
        record.caloriesBurned += Number(caloriesBurned);
      if (exerciseName) record.exerciseName = exerciseName;
      await record.save();
    } else {
      record = await Exercise.create({
        user: userId,
        date,
        steps: steps || 0,
        caloriesBurned: caloriesBurned || 0,
        exerciseName: exerciseName || "",
      });
    }

    // 🟢 1. Fetch User Profile to update Streak & Total cumulative steps
    const user = await User.findById(userId);
    if (user) {
      // Total steps cumulative update (or fetch from exercise sum)
      if (steps !== undefined) {
        user.steps = (user.steps || 0) + Number(steps);
      }

      // 🟢 2. Streak Management Logic
      const todayStr = date || new Date().toISOString().split("T")[0];
      if (user.lastLoggedDate !== todayStr) {
        user.streakCount = (user.streakCount || 0) + 1;
        user.lastLoggedDate = todayStr;
      }

      // 🟢 3. Badge Auto-Unlock Evaluation Logic
      if (!user.unlockedBadges) user.unlockedBadges = [];
      const earnedBadgeIds = user.unlockedBadges.map((b) => b.badgeId);

      // Example Thresholds: 5,000 steps & 10,000 steps
      if (user.steps >= 5000 && !earnedBadgeIds.includes("steps_5k")) {
        user.unlockedBadges.push({
          badgeId: "steps_5k",
          unlockedAt: new Date(),
        });
      }
      if (user.steps >= 10000 && !earnedBadgeIds.includes("steps_10k")) {
        user.unlockedBadges.push({
          badgeId: "steps_10k",
          unlockedAt: new Date(),
        });
      }

      await user.save();
    }

    res.status(200).json({
      success: true,
      data: record,
      userStats: user
        ? { streakCount: user.streakCount, unlockedBadges: user.unlockedBadges }
        : null,
      message: "Exercise and steps updated successfully!",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getExerciseData,
  logExerciseOrSteps,
};
