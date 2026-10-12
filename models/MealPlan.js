const mongoose = require("mongoose");

const MealPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    goal: {
      type: String,
      enum: ["weight_loss", "muscle_gain", "maintenance"],
      default: "weight_loss",
    },
    dietType: {
      type: String,
      default: "Desi / Pakistani Standard",
    },
    targetCalories: {
      type: Number,
      required: true,
    },
    days: [
      {
        day: { type: String, required: true }, // e.g., "Monday"
        meals: {
          breakfast: {
            name: String,
            calories: Number,
            protein: Number,
            carbs: Number,
            fats: Number,
          },
          lunch: {
            name: String,
            calories: Number,
            protein: Number,
            carbs: Number,
            fats: Number,
          },
          dinner: {
            name: String,
            calories: Number,
            protein: Number,
            carbs: Number,
            fats: Number,
          },
          snack: {
            name: String,
            calories: Number,
            protein: Number,
            carbs: Number,
            fats: Number,
          },
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("MealPlan", MealPlanSchema);
