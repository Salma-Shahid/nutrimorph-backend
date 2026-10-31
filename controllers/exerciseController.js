const Exercise = require("../models/ExerciseModel");
const User = require("../models/User");
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

// Log Exercise or Update Steps with Accurate Streak & Badges Evaluator
const logExerciseOrSteps = async (req, res, next) => {
  try {
    const { date, steps, caloriesBurned, exerciseName } = req.body;
    const userId = req.user._id;
    const logDate = date || new Date().toISOString().split("T")[0];

    let record = await Exercise.findOne({ user: userId, date: logDate });

    if (record) {
      if (steps !== undefined) record.steps += Number(steps);
      if (caloriesBurned !== undefined)
        record.caloriesBurned += Number(caloriesBurned);
      if (exerciseName) record.exerciseName = exerciseName;
      await record.save();
    } else {
      record = await Exercise.create({
        user: userId,
        date: logDate,
        steps: steps || 0,
        caloriesBurned: caloriesBurned || 0,
        exerciseName: exerciseName || "",
      });
    }

    // 🟢 Fetch User Profile strictly by authenticated userId
    const user = await User.findById(userId);
    if (user) {
      // Cumulative total steps update
      if (steps !== undefined) {
        user.steps = (user.steps || 0) + Number(steps);
      }

      // 🟢 Robust Streak Management Logic
      const todayStr = logDate;
      const lastDate = user.lastLoggedDate;

      if (!lastDate) {
        user.streakCount = 1;
        user.lastLoggedDate = todayStr;
      } else if (lastDate !== todayStr) {
        const last = new Date(lastDate);
        const curr = new Date(todayStr);
        const diffDays = Math.round((curr - last) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          // Consecutive day log -> Increment streak
          user.streakCount = (user.streakCount || 0) + 1;
          user.lastLoggedDate = todayStr;
        } else if (diffDays > 1) {
          // Streak broken -> Reset to 1
          user.streakCount = 1;
          user.lastLoggedDate = todayStr;
        }
        // If diffDays === 0 (same day), do nothing to streak count
      }

      // 🟢 Badge Auto-Unlock Evaluation Logic for Steps
      if (!user.unlockedBadges) user.unlockedBadges = [];
      const earnedBadgeIds = user.unlockedBadges.map((b) =>
        typeof b === "string" ? b : b.badgeId,
      );

      const stepMilestones = [
        { count: 5000, id: "steps_5k" },
        { count: 10000, id: "steps_10k" },
        { count: 15000, id: "steps_15k" },
        { count: 20000, id: "steps_20k" },
        { count: 25000, id: "steps_25k" },
        { count: 30000, id: "steps_30k" },
      ];

      stepMilestones.forEach((milestone) => {
        if (
          user.steps >= milestone.count &&
          !earnedBadgeIds.includes(milestone.id)
        ) {
          user.unlockedBadges.push({
            badgeId: milestone.id,
            unlockedAt: new Date(),
          });
        }
      });

      await user.save();
    }

    res.status(200).json({
      success: true,
      data: record,
      userStats: user
        ? {
            steps: user.steps,
            streakCount: user.streakCount,
            unlockedBadges: user.unlockedBadges,
          }
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
