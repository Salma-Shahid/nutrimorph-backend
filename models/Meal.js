const mongoose = require("mongoose");

const MealSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    name: {
      type: String,
      required: true,
    },
    calories: {
      type: Number,
      required: true,
    },
    protein: { type: Number, default: 0 },
    carbs: { type: Number, default: 0 },
    fats: { type: Number, default: 0 },
    mealType: { type: String, default: "snack" },

    // 🟢 IS FIELD KO ADD KAREIN:
    date: {
      type: String, // Format: "YYYY-MM-DD"
      required: true,
      index: true, // Fast queries ke liye
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Meal", MealSchema);
