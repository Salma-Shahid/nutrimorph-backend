const mongoose = require("mongoose");
const SavedMeal = require("./models/SavedMeal");
require("dotenv").config();

const sampleRecipes = [
  {
    name: "Grilled Chicken & Quinoa Bowl",
    category: "High-Protein",
    calories: 520,
    protein: 48,
    carbs: 42,
    fats: 12,
    isGlobal: true,
    image:
      "https://media.istockphoto.com/id/908070288/photo/healthy-chicken-and-quinoa-bowl.webp?a=1&b=1&s=612x612&w=0&k=20&c=wmICc63b-y0AGhTIr_UbJOPH2yWNy1nKSug45BGSS9c=",
    ingredients: [
      "200g Chicken Breast",
      "1 cup Quinoa",
      "1/2 Avocado",
      "Fresh Spinach",
    ],
    directions: [
      "Grill chicken breast with spices.",
      "Cook quinoa in water for 15 mins.",
      "Mix together in a bowl with spinach and avocado.",
    ],
  },
  {
    name: "Banana Oats Whey Smoothie",
    category: "Pre-Workout",
    calories: 380,
    protein: 30,
    carbs: 52,
    fats: 6,
    isGlobal: true,
    image:
      "https://images.unsplash.com/photo-1542444592-0d5997f202eb?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D",
    ingredients: [
      "1 Banana",
      "1 Scoop Whey Protein",
      "1/2 cup Oats",
      "250ml Almond Milk",
    ],
    directions: [
      "Add all ingredients to a blender.",
      "Blend on high speed for 60 seconds till smooth.",
    ],
  },
  {
    name: "Greek Yogurt & Berry Recovery Parfait",
    category: "Post-Workout",
    calories: 310,
    protein: 26,
    carbs: 38,
    fats: 4,
    isGlobal: true,
    image:
      "https://media.istockphoto.com/id/2208382438/photo/homemade-healthy-breakfast-yogurt-parfait.webp?a=1&b=1&s=612x612&w=0&k=20&c=RgtJ-YBQuHlFqFEEpQf19zGEUPfo_fojOBfqgaVwne8=",
    ingredients: [
      "200g Low-fat Greek Yogurt",
      "1/2 cup Mixed Berries",
      "1 tbsp Honey",
    ],
    directions: [
      "Layer yogurt and berries in a cup.",
      "Drizzle honey on top before serving.",
    ],
  },
  {
    name: "Citrus Ginger Immunity Booster Salad",
    category: "Immune Support",
    calories: 240,
    protein: 8,
    carbs: 30,
    fats: 10,
    isGlobal: true,
    image:
      "https://images.unsplash.com/photo-1691749123977-0701680083b8?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D",
    ingredients: [
      "1 Orange",
      "Fresh Ginger Dressing",
      "Baby Spinach",
      "Walnuts",
    ],
    directions: [
      "Slice oranges and chop walnuts.",
      "Toss with spinach and ginger dressing.",
    ],
  },
  {
    name: "Classic Egg & Toast Staples",
    category: "Pantry Staples",
    calories: 340,
    protein: 20,
    carbs: 28,
    fats: 16,
    isGlobal: true,
    image:
      "https://media.istockphoto.com/id/1367331230/photo/traditional-english-crumpets-or-muffins.webp?a=1&b=1&s=612x612&w=0&k=20&c=vRv7Oi8-JZoZ0FkMN6mAJNC8-IfdpK7LQfjiffFvOC0=",
    ingredients: ["3 Whole Eggs", "2 Slices Whole Wheat Bread", "1 tsp Butter"],
    directions: ["Scramble eggs in butter.", "Toast bread and serve warm."],
  },
];

const seedDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    await SavedMeal.deleteMany({ isGlobal: true });
    await SavedMeal.insertMany(sampleRecipes);
    console.log("✅ Sample recipes seeded successfully!");
    process.exit();
  } catch (err) {
    console.error("❌ Seeding Error:", err.message);
    process.exit(1);
  }
};

seedDB();
