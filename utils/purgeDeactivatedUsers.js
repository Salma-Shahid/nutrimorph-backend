const User = require("../models/User");
const ChatMessage = require("../models/ChatMessage");
const Meal = require("../models/Meal");
const Water = require("../models/Water");
const Exercise = require("../models/ExerciseModel");
const MealPlan = require("../models/MealPlan");
const SavedMeal = require("../models/SavedMeal");
const WeightEntry = require("../models/WeightEntry");
const connectDB = require("../config/db");

const purgeDeactivatedUsers = async (now = new Date()) => {
  await connectDB();
  const expiredUsers = await User.find({
    deactivatedAt: { $ne: null },
    deactivationExpiresAt: { $lte: now },
  })
    .select("_id")
    .lean();

  let purgedCount = 0;
  for (const { _id: userId } of expiredUsers) {
    await Promise.all([
      ChatMessage.deleteMany({ $or: [{ userId }, { user: userId }] }),
      Meal.deleteMany({ $or: [{ userId }, { user: userId }] }),
      Water.deleteMany({ userId }),
      Exercise.deleteMany({ $or: [{ userId }, { user: userId }] }),
      MealPlan.deleteMany({ userId }),
      SavedMeal.deleteMany({ userId, isGlobal: { $ne: true } }),
      WeightEntry.deleteMany({ userId }),
    ]);

    const result = await User.deleteOne({
      _id: userId,
      deactivatedAt: { $ne: null },
      deactivationExpiresAt: { $lte: now },
    });
    purgedCount += result.deletedCount || 0;
  }

  return purgedCount;
};

module.exports = purgeDeactivatedUsers;
