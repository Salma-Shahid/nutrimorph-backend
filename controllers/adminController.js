const User = require("../models/User");
const Meal = require("../models/Meal");
const Exercise = require("../models/ExerciseModel");

// 1. Get Platform Stats & Metrics
const getAdminStats = async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments();
    const proUsers = await User.countDocuments({ subscriptionTier: "pro" });
    const totalMeals = await Meal.countDocuments();
    const totalExercises = await Exercise.countDocuments();

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        proUsers,
        freeUsers: totalUsers - proUsers,
        totalMeals,
        totalExercises,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get All Registered Users
const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Update User Subscription Tier (Free <-> Pro)
const updateUserTier = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subscriptionTier } = req.body; // "free" or "pro"

    if (!["free", "pro"].includes(subscriptionTier)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid subscription tier" });
    }

    const user = await User.findByIdAndUpdate(
      id,
      {
        subscriptionTier,
        isPro: subscriptionTier === "pro",
      },
      { new: true, runValidators: true },
    ).select("-password");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      message: `User subscription updated to ${subscriptionTier}`,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Delete User & Their Related Data
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Clean up user operational data
    await Meal.deleteMany({ $or: [{ userId: id }, { user: id }] });
    await Exercise.deleteMany({ user: id });

    return res.status(200).json({
      success: true,
      message: "User and associated data deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const getRevenueStats = async (req, res) => {
  try {
    const proUsersCount = await User.countDocuments({
      subscriptionTier: "pro",
    });
    const estimatedRevenue = proUsersCount * 9.99; // Maslan $9.99 per pro user

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: estimatedRevenue,
        activeSubscriptions: proUsersCount,
        currency: "USD",
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all reviews for moderation
const getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.find()
      .sort({ createdAt: -1 })
      .populate("user", "name email");
    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete or moderate review
const deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Review not found" });
    }
    await review.deleteOne();
    res
      .status(200)
      .json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAdminStats,
  getAllUsers,
  updateUserTier,
  deleteUser,
  getRevenueStats,
  getAllReviews,
  deleteReview,
};
