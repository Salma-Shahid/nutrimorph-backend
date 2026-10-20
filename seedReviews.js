const mongoose = require("mongoose");
require("dotenv").config();

// MongoDB Review Schema (Aapka banaya hua schema)
const reviewSchema = new mongoose.Schema({
  reviewId: { type: String, unique: true },
  author: String,
  comment: String,
  rating: Number,
  updatedAt: { type: Date, default: Date.now },
});

const Review = mongoose.model("Review", reviewSchema);

const dummyReviews = [
  {
    reviewId: "test_review_1",
    author: "Ayesha Khan",
    comment: "Amazing app! Bohat helpful hai diet tracking ke liye.",
    rating: 5,
  },
  {
    reviewId: "test_review_2",
    author: "Ali Ahmed",
    comment: "Good user interface, easy to use.",
    rating: 4,
  },
  {
    reviewId: "test_review_3",
    author: "Fatima Noor",
    comment: "Awesome experience, loved the features!",
    rating: 5,
  },
];

const seedDB = async () => {
  try {
    // Apni MongoDB connection string yahan likhein (ya .env se load karein)
    await mongoose.connect(
      process.env.MONGO_URI || "mongodb://localhost:27017/nutrimorph",
    );
    console.log("📦 Connected to MongoDB for seeding...");

    await Review.deleteMany({}); // Purane dummy reviews clear karne ke liye
    await Review.insertMany(dummyReviews);

    console.log("✅ Dummy reviews inserted successfully!");
    process.exit();
  } catch (error) {
    console.error("❌ Error seeding reviews:", error);
    process.exit(1);
  }
};

seedDB();
