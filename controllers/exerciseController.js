const Exercise = require("../models/ExerciseModel");
const User = require("../models/User");
const AppError = require("../utils/appError");

// 🟢 Get Daily Exercise & Steps Summary (Strict Per-User Isolation)
const getExerciseData = async (req, res, next) => {
  try {
    const { date } = req.query;
    const userId = req.user._id;

    // Strict Query Isolation by User ID
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

// 🟢 Log Exercise or Update Steps with Accurate Streak & Badges Evaluator
const logExerciseOrSteps = async (req, res, next) => {
  try {
    const { date, steps, stepsTotal, caloriesBurned, exerciseName } = req.body;
    const userId = req.user._id;
    const logDate = date || new Date().toISOString().split("T")[0];

    if (
      stepsTotal !== undefined &&
      (!Number.isFinite(Number(stepsTotal)) || Number(stepsTotal) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "stepsTotal must be a non-negative number.",
      });
    }

    // 1. Atomic Upsert for Daily Exercise Log Linked to Logged-in User
    let record = await Exercise.findOne({ user: userId, date: logDate });
    const previousDailySteps = Number(record?.steps) || 0;

    if (record) {
      if (stepsTotal !== undefined) {
        record.steps = Math.max(previousDailySteps, Number(stepsTotal));
      } else if (steps !== undefined) {
        record.steps += Number(steps);
      }
      if (caloriesBurned !== undefined)
        record.caloriesBurned += Number(caloriesBurned);
      if (exerciseName) record.exerciseName = exerciseName;
      await record.save();
    } else {
      record = await Exercise.create({
        user: userId,
        date: logDate,
        steps:
          stepsTotal !== undefined
            ? Number(stepsTotal)
            : steps
              ? Number(steps)
              : 0,
        caloriesBurned: caloriesBurned ? Number(caloriesBurned) : 0,
        exerciseName: exerciseName || "",
      });
    }

    // 2. Fetch User Profile Strictly by Authenticated User ID
    const user = await User.findById(userId);
    if (user) {
      if (stepsTotal !== undefined) {
        user.steps =
          (Number(user.steps) || 0) +
          Math.max(0, (Number(record.steps) || 0) - previousDailySteps);
      } else if (steps !== undefined) {
        user.steps = (Number(user.steps) || 0) + Number(steps);
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
          user.streakCount = (user.streakCount || 0) + 1;
          user.lastLoggedDate = todayStr;
        } else if (diffDays > 1) {
          user.streakCount = 1;
          user.lastLoggedDate = todayStr;
        }
      }

      // 🟢 Badge Auto-Unlock Evaluation Logic (Checking Daily Record Steps & User Stats)
      if (!user.unlockedBadges) user.unlockedBadges = [];
      const earnedBadgeIds = user.unlockedBadges.map((badge) => {
        const badgeId =
          typeof badge === "string" ? badge : badge?.badgeId || badge?.id;
        return String(badgeId || "").replace(/^steps_/, "step_");
      });

      const stepMilestones = [
        { count: 5000, id: "step_5k" },
        { count: 10000, id: "step_10k" },
        { count: 15000, id: "step_15k" },
        { count: 20000, id: "step_20k" },
        { count: 25000, id: "step_25k" },
        { count: 30000, id: "step_30k" },
      ];

      // Check against today's record steps OR cumulative user steps
      const currentDailySteps = record.steps || 0;

      stepMilestones.forEach((milestone) => {
        if (
          (currentDailySteps >= milestone.count ||
            (Number(user.steps) || 0) >= milestone.count) &&
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
            dailySteps: record.steps,
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
