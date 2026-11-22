const mongoose = require("mongoose");

const savedMealSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Global recipes do not require an owner.
    },
    email: { type: String, lowercase: true, trim: true },
    cuisine: { type: String, trim: true, index: true },
    isGlobal: {
      type: Boolean,
      default: false, // true = Available for all users in Explore Library
    },
    name: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        "Post-Workout",
        "Pre-Workout",
        "High-Protein",
        "Immune Support",
        "Pantry Staples",
        "Weight Loss",
        "Plant-Based",
        "Vegetarian",
        "Vegan",
        "Keto",
        "Low-Carb",
        "Gluten-Free",
        "Dairy-Free",
        "Breakfast",
        "Lunch",
        "Dinner",
        "Snack",
        "Dessert",
      ],
      default: "High-Protein",
    },
    calories: { type: Number, default: 0 },
    protein: { type: Number, default: 0 },
    carbs: { type: Number, default: 0 },
    fats: { type: Number, default: 0 },
    servingSize: { type: String, trim: true, maxlength: 120, default: "1 serving" },
    image: {
      type: String,
      default: "",
    },
    ingredients: [
      {
        type: String,
      },
    ],
    directions: [
      {
        type: String,
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("SavedMeal", savedMealSchema);
