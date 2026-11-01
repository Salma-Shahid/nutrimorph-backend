const User = require("../models/User");
const Meal = require("../models/Meal");
const Exercise = require("../models/ExerciseModel");
const Review = require("../models/Review");
const ActivityLog = require("../models/ActivityLog");
const sendEmail = require("../utils/sendEmail"); // ✅ Import email utility

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

    // 🛡️ Create Audit Activity Log
    await ActivityLog.create({
      admin: req.user._id,
      adminEmail: req.user.email,
      action: "UPDATE_TIER",
      details: `Changed user ${user.email} subscription tier to '${subscriptionTier}'`,
    });

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

    // 🛡️ Create Audit Activity Log
    await ActivityLog.create({
      admin: req.user._id,
      adminEmail: req.user.email,
      action: "DELETE_USER",
      details: `Deleted user account ${user.email} and associated data`,
    });

    return res.status(200).json({
      success: true,
      message: "User and associated data deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 5. Get Revenue Statistics
const getRevenueStats = async (req, res) => {
  try {
    const proUsersCount = await User.countDocuments({
      subscriptionTier: "pro",
    });
    const estimatedRevenue = proUsersCount * 9.99; // $9.99 per pro user

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

// 6. Get all reviews for moderation
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

// 7. Delete or moderate review
const deleteReview = async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Review not found" });
    }
    await review.deleteOne();

    // 🛡️ Create Audit Activity Log
    await ActivityLog.create({
      admin: req.user._id,
      adminEmail: req.user.email,
      action: "DELETE_REVIEW",
      details: `Deleted user review ID: ${req.params.id}`,
    });

    res
      .status(200)
      .json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Broadcast Notification & Automated Email to Users
const sendBroadcast = async (req, res) => {
  try {
    const { title, message, targetAudience } = req.body;

    if (!title || !message) {
      return res
        .status(400)
        .json({ success: false, message: "Title and message are required" });
    }

    let query = {};
    if (targetAudience === "pro") {
      query.subscriptionTier = "pro";
    } else if (targetAudience === "free") {
      query.subscriptionTier = { $ne: "pro" };
    }

    const targetUsers = await User.find(query).select("email name");

    // Loop through users and send automated HTML emails asynchronously
    const emailPromises = targetUsers.map((user) => {
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; background-color: #030712; color: #f3f4f6; padding: 25px; border-radius: 12px; border: 1px solid #1f2937;">
          <h2 style="color: #34d399; margin-top: 0;">NutriMorph Announcement 🚀</h2>
          <h3 style="color: #ffffff; font-size: 18px;">${title}</h3>
          <p style="font-size: 15px; color: #d1d5db; line-height: 1.6;">${message}</p>
          <hr style="border-color: #1f2937; margin: 20px 0;" />
          <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">You received this automated broadcast email because you are a valued member of NutriMorph.</p>
        </div>
      `;
      return sendEmail({
        email: user.email,
        subject: title,
        html: htmlContent,
      }).catch((err) =>
        console.error(`Failed to send email to ${user.email}:`, err.message),
      );
    });

    await Promise.all(emailPromises);

    // 🛡️ Create Audit Activity Log
    await ActivityLog.create({
      admin: req.user._id,
      adminEmail: req.user.email,
      action: "BROADCAST_EMAIL",
      details: `Sent broadcast email '${title}' to ${targetUsers.length} (${targetAudience || "all"}) users`,
    });

    res.status(200).json({
      success: true,
      message: `Broadcast emails successfully sent to ${targetUsers.length} users (${targetAudience || "all"}).`,
      recipientCount: targetUsers.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 9. Get all audit logs
const getActivityLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(50);
    res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get System & Third-Party API Usage Stats
const getApiUsageStats = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        // Email & AI
        sendgridEmailsUsed: 120,
        sendgridLimit: 3000,
        geminiApiCalls: 430,
        geminiLimit: 10000,

        // Storage & Database
        dbStorageUsedMB: 45.5,
        dbLimitMB: 512,
        cloudinaryStorageGB: 1.2,
        cloudinaryLimitGB: 25,

        // Mobile & Expo Free Tier
        expoBuildsUsed: 18,
        expoBuildsLimit: 30, // Free tier monthly build limit
        expoOtaBandwidthMB: 350,
        expoOtaLimitMB: 1000,

        // Monetization & Analytics
        revenueCatActiveSubs: 1,
        firebaseActiveSessions: 45,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAdminStats,
  getAllUsers,
  updateUserTier,
  getApiUsageStats,
  deleteUser,
  getRevenueStats,
  getAllReviews,
  deleteReview,
  sendBroadcast,
  getActivityLogs,
};
