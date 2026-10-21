const mongoose = require("mongoose");

const recipeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    category: {
      type: String,
      enum: [
        "Pre-Workout",
        "Post-Workout",
        "High-Protein",
        "Weight Loss",
        "Pantry Staples",
      ],
      required: true,
    },
    calories: { type: Number, required: true },
    protein: { type: Number, required: true }, // in grams
    carbs: { type: Number, required: true }, // in grams
    fats: { type: Number, required: true }, // in grams
    prepTime: { type: String, default: "15 mins" },
    image: { type: String, default: null },
    ingredients: [{ type: String }],
    instructions: [{ type: String }],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Recipe", recipeSchema);
