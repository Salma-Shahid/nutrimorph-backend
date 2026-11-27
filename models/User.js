const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },

    //  Role & Permissions (New for Admin Dashboard)
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    //  Email Verification Fields
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpires: { type: Date },
    passwordResetToken: { type: String, select: false },
    passwordResetTokenExpires: { type: Date, select: false },

    //  Subscription Fields
    subscriptionTier: {
      type: String,
      enum: ["free", "pro"],
      default: "free",
    },
    isPro: { type: Boolean, default: false },
    subscriptionExpiresAt: { type: Date },
    subscriptionStatus: { type: String, default: "free" },
    trialStartDate: { type: Date },
    trialEndDate: { type: Date },
    trialUsedAt: { type: Date },
    paddleCustomerId: { type: String },
    paddleSubscriptionId: { type: String },
    paddlePriceId: { type: String },
    paddleLastEventAt: { type: Date },
    // Which system last granted the current plan. Used so one provider's
    // cancellation never revokes access granted by another.
    billingProvider: {
      type: String,
      enum: [null, "paddle", "revenuecat", "admin"],
      default: null,
    },
    revenueCatProductId: { type: String },
    revenueCatLastSyncedAt: { type: Date },
    deactivatedAt: { type: Date, default: null },
    deactivationExpiresAt: { type: Date, default: null },
    accountDeletionToken: { type: String, select: false },
    accountDeletionTokenExpires: { type: Date, select: false },

    //  Free Limits Tracking
    dailyChatCount: { type: Number, default: 0 },
    lastChatDate: { type: Date, default: Date.now },
    dailyScanCount: { type: Number, default: 0 },
    dailyScanDate: { type: String, default: null },

    //  Profile & Health Metrics (Enhanced for Onboarding Wizard)
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
    medicalCondition: { type: String, default: "None" },
    // Free-text cuisine/diet preference, e.g. "Desi", "Western", "Vegetarian".
    dietPreference: { type: String, trim: true, maxlength: 60, default: "" },
    preferredMealsCount: { type: Number, default: 4 },
    dailyCalories: { type: Number, default: 2000 },
    dailyCalorieGoal: { type: Number, default: 2000 },
    dailyCalorieTarget: { type: Number, default: 2000 },
    macros: {
      protein: { type: Number },
      carbs: { type: Number },
      fats: { type: Number },
    },

    //  Gamification & Engagement (Streak & Badges)
    steps: { type: Number, default: 0 },
    streakCount: { type: Number, default: 0 },
    lastLoggedDate: { type: String, default: null },
    // Longest streak ever; decides the Pro gem tier.
    bestStreak: { type: Number, default: 0 },
    unlockedBadges: [
      {
        badgeId: { type: String, required: true },
        unlockedAt: { type: Date, default: Date.now },
      },
    ],

    //  Gems & Streak Revive
    gems: { type: Number, default: 0, min: 0 },
    // "YYYY-MM" of the last monthly Pro gem grant (one grant per month).
    gemsLastGrantMonth: { type: String, default: null },
    gemsLastGrantTier: { type: String, default: null },
    // Rewarded-ad gems claimed today (capped per day).
    adRewardDate: { type: String, default: null },
    adRewardCount: { type: Number, default: 0 },
    // Snapshot taken when a streak resets, so it can still be revived after
    // the user logs again on the day the break was detected.
    lostStreak: { type: Number, default: 0 },
    lostStreakOn: { type: String, default: null },
    lostStreakMissedDays: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const dayNumber = (value) => {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) ? Math.round(time / 86400000) : null;
};

// Streaks are updated in several controllers; tracking here keeps best-streak
// and broken-streak bookkeeping in one place.
userSchema.post("init", function rememberStreak() {
  this.$locals.previousStreak = Number(this.streakCount) || 0;
  this.$locals.previousLastLoggedDate = this.lastLoggedDate || null;
});

userSchema.pre("save", function trackStreakChanges() {
  const current = Number(this.streakCount) || 0;
  if (current > (Number(this.bestStreak) || 0)) this.bestStreak = current;

  const previous = this.$locals.previousStreak;
  if (
    this.isModified("streakCount") &&
    current === 1 &&
    Number(previous) >= 2 &&
    this.lastLoggedDate &&
    this.$locals.previousLastLoggedDate
  ) {
    const gap =
      dayNumber(this.lastLoggedDate) -
      dayNumber(this.$locals.previousLastLoggedDate) -
      1;
    if (Number.isFinite(gap) && gap >= 1) {
      this.lostStreak = Number(previous);
      this.lostStreakOn = this.lastLoggedDate;
      this.lostStreakMissedDays = gap;
    }
  }
  this.$locals.previousStreak = current;
  this.$locals.previousLastLoggedDate = this.lastLoggedDate || null;
});

module.exports = mongoose.model("User", userSchema);
