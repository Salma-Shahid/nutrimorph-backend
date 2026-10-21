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
    isOnboardingCompleted: { type: Boolean, default: false },
    language: { type: String, default: "English" },
    avatar: { type: String, default: null },
    profileImage: { type: String, default: null },
    age: { type: Number },
    gender: { type: String },
    dob: { type: Date },
    weight: { type: Number },
    height: { type: Number },
    targetWeight: { type: Number },
    bmi: { type: Number },
    bmiCategory: { type: String },
    goal: { type: String },
    fitnessGoal: { type: String },
    activityLevel: { type: String },
    medicalCondition: { type: String, default: "None" }, // 🟢 Added for medical history
    preferredMealsCount: { type: Number, default: 4 },
    dailyCalories: { type: Number, default: 2000 },
    dailyCalorieGoal: { type: Number, default: 2000 },
    macros: {
      protein: { type: Number },
      carbs: { type: Number },
      fats: { type: Number },
    },

    // 🔥 Gamification & Engagement (Streak & Badges)
    streakCount: { type: Number, default: 0 }, // 🟢 Daily consecutive logging streak
    lastLoggedDate: { type: String, default: null }, // 🟢 Format: "YYYY-MM-DD"
    unlockedBadges: [
      {
        badgeId: { type: String, required: true },
        unlockedAt: { type: Date, default: Date.now },
      },
    ], // 🟢 Unlocked achievement badges list
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
