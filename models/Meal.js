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
    email: { type: String, lowercase: true, trim: true },
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
    servingSize: { type: String, trim: true, maxlength: 120 },

    //  Standardized Meal Type Enum:
    mealType: {
      type: String,
      enum: ["Breakfast", "Lunch", "Dinner", "Snack", "Late-night"],
      default: "Lunch",
      required: true,
    },

    date: {
      type: String, // Format: "YYYY-MM-DD"
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Meal", MealSchema);
