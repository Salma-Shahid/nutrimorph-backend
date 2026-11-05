const Exercise = require("../models/ExerciseModel");
const User = require("../models/User");
const AppError = require("../utils/appError");
const { updateStreak } = require("../utils/streak");

//  Get Daily Exercise & Steps Summary (Strict Per-User Isolation)
const getExerciseData = async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({
        success: false,
        message: "A date in YYYY-MM-DD format is required.",
      });
    }
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

//  Log Exercise or Update Steps with Accurate Streak & Badges Evaluator
const logExerciseOrSteps = async (req, res, next) => {
  try {
    const {
      date,
      steps,
      stepsTotal,
      stepsDelta,
      caloriesBurned,
      exerciseName,
    } = req.body;
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
    if (
      steps !== undefined &&
      (!Number.isFinite(Number(steps)) ||
        !Number.isInteger(Number(steps)) ||
        Number(steps) < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "steps must be a non-negative integer.",
      });
    }
    if (
      stepsDelta !== undefined &&
      (!Number.isInteger(Number(stepsDelta)) ||
        Math.abs(Number(stepsDelta)) > 100000)
    ) {
      return res.status(400).json({
        success: false,
        message: "stepsDelta must be an integer between -100000 and 100000.",
      });
    }

    if (stepsDelta !== undefined) {
      const delta = Number(stepsDelta);
      const query = { user: userId, date: logDate };
      const previousRecord = await Exercise.findOne(query);
      const previousDailySteps = Number(previousRecord?.steps) || 0;
      const record = await Exercise.findOneAndUpdate(
        query,
        [
          {
            $set: {
              steps: {
                $max: [0, { $add: [{ $ifNull: ["$steps", 0] }, delta] }],
              },
              user: userId,
              date: logDate,
              caloriesBurned: { $ifNull: ["$caloriesBurned", 0] },
              exerciseName: { $ifNull: ["$exerciseName", ""] },
            },
          },
        ],
        { upsert: true, new: true },
      );
      const actualDelta = Number(record.steps) - previousDailySteps;
      const user = await User.findById(userId);
      if (user) {
        user.steps = Math.max(0, (Number(user.steps) || 0) + actualDelta);
        const streak = updateStreak(
          user.lastLoggedDate,
          user.streakCount,
          logDate,
        );
        user.streakCount = streak.streak;
        user.lastLoggedDate = streak.lastLoggedDate;

        if (!user.unlockedBadges) user.unlockedBadges = [];

        const existingBadges = new Set(
          (user.unlockedBadges || []).map((badge) =>
            String(badge.badgeId || badge.id || badge).replace(
              /^steps_/,
              "step_",
            ),
          ),
        );
        for (const [count, badgeId] of [
          [5000, "step_5k"],
          [10000, "step_10k"],
          [15000, "step_15k"],
          [20000, "step_20k"],
          [25000, "step_25k"],
          [30000, "step_30k"],
        ]) {
          if (record.steps >= count && !existingBadges.has(badgeId)) {
            user.unlockedBadges.push({ badgeId });
            existingBadges.add(badgeId);
          }
        }
        await user.save();
      }

      return res.status(200).json({
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

      //  Robust Streak Management Logic
      const streak = updateStreak(
        user.lastLoggedDate,
        user.streakCount,
        logDate,
      );
      user.streakCount = streak.streak;
      user.lastLoggedDate = streak.lastLoggedDate;

      //  Badge Auto-Unlock Evaluation Logic (Checking Daily Record Steps & User Stats)
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

    return res.status(200).json({
      success: true,
      data: record,
      userStats: user
        ? {
            steps: user.steps || 0,
            dailySteps: record.steps || 0,
            streakCount: user.streakCount || 0,
            unlockedBadges: user.unlockedBadges || [],
          }
        : {
            steps: 0,
            dailySteps: record.steps || 0,
            streakCount: 0,
            unlockedBadges: [],
          },
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
