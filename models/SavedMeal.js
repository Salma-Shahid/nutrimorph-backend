const mongoose = require("mongoose");

const savedMealSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // System/Global recipes ke liye optional rakha hai
    },
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
      ],
      default: "High-Protein",
    },
    calories: { type: Number, default: 0 },
    protein: { type: Number, default: 0 },
    carbs: { type: Number, default: 0 },
    fats: { type: Number, default: 0 },
    image: {
      type: String,
      default:
        "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=600",
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
