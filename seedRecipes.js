const mongoose = require("mongoose");
const fs = require("fs");
const SavedMeal = require("./models/SavedMeal");
require("dotenv").config();

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // JSON file read aur parse karna
    const rawData = fs.readFileSync("./recipes.json", "utf-8");
    const sampleRecipes = JSON.parse(rawData);

    await SavedMeal.deleteMany({ isGlobal: true });
    await SavedMeal.insertMany(sampleRecipes);
    console.log("✅ All recipes seeded successfully from JSON file!");
    process.exit();
  } catch (err) {
    console.error("❌ Seeding Error:", err.message);
    process.exit(1);
  }
};

seedDB();
