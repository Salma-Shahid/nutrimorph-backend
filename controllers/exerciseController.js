const Exercise = require("../models/ExerciseModel");
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

// Log Exercise or Update Steps
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

    res.status(200).json({
      success: true,
      data: record,
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
