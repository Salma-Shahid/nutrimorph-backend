const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },

    // 📧 Email Verification Fields
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpires: { type: Date },

    // 💳 Subscription Fields
    subscriptionTier: {
      type: String,
      enum: ["free", "pro"],
      default: "free",
    },
    isPro: { type: Boolean, default: false },
    subscriptionExpiresAt: { type: Date },

    // 🤖 Free Limits Tracking
    dailyChatCount: { type: Number, default: 0 },
    lastChatDate: { type: Date, default: Date.now },

    // 🏋️ Profile & Health Metrics (Enhanced for Onboarding Wizard)
    isOnboarded: { type: Boolean, default: false },
    isOnboardingCompleted: { type: Boolean, default: false }, // 🟢 Added for wizard completion flag
    language: { type: String, default: "English" }, // 🟢 Added language preference
    avatar: { type: String, default: null },
    profileImage: { type: String, default: null },
    age: { type: Number },
    gender: { type: String },
    dob: { type: Date }, // 🟢 Added date of birth
    weight: { type: Number },
    height: { type: Number },
    targetWeight: { type: Number }, // 🟢 Added target weight goal
    bmi: { type: Number }, // 🟢 Added calculated BMI
    bmiCategory: { type: String }, // 🟢 Added BMI category (Normal, Overweight, etc.)
    goal: { type: String },
    fitnessGoal: { type: String }, // 🟢 Added fitness goal mapping
    activityLevel: { type: String }, // 🟢 Added activity level (TDEE multiplier)
    preferredMealsCount: { type: Number, default: 4 }, // 🟢 Added preferred meals per day
    dailyCalories: { type: Number, default: 2000 },
    dailyCalorieGoal: { type: Number, default: 2000 },
    macros: {
      protein: { type: Number },
      carbs: { type: Number },
      fats: { type: Number },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
