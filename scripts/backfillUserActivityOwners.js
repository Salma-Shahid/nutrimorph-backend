require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../models/User");
const Meal = require("../models/Meal");
const Water = require("../models/Water");
const Exercise = require("../models/ExerciseModel");
const MealPlan = require("../models/MealPlan");
const SavedMeal = require("../models/SavedMeal");
const ChatMessage = require("../models/ChatMessage");

const backfillUserActivityOwners = async () => {
  await connectDB();
  const users = await User.find().select("_id email").lean();
  let updatedDocuments = 0;

  for (const user of users) {
    const owner = user._id;
    const email = user.email;
    const updates = await Promise.all([
      Meal.updateMany(
        { $or: [{ userId: owner }, { user: owner }] },
        { $set: { userId: owner, user: owner, email } },
      ),
      Water.updateMany({ userId: owner }, { $set: { email } }),
      Exercise.updateMany(
        { $or: [{ userId: owner }, { user: owner }] },
        { $set: { userId: owner, user: owner, email } },
      ),
      MealPlan.updateMany({ userId: owner }, { $set: { email } }),
      SavedMeal.updateMany(
        { userId: owner, isGlobal: { $ne: true } },
        { $set: { email } },
      ),
      ChatMessage.updateMany(
        { $or: [{ userId: owner }, { user: owner }] },
        { $set: { userId: owner, user: owner, email } },
      ),
    ]);
    updatedDocuments += updates.reduce(
      (count, result) => count + (result.modifiedCount || 0),
      0,
    );
  }

  console.log(`Updated owner fields on ${updatedDocuments} user records.`);
};

backfillUserActivityOwners()
  .catch((error) => {
    console.error("User activity owner migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
