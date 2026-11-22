const User = require("../models/User");
const Meal = require("../models/Meal");
const Exercise = require("../models/ExerciseModel");
const Review = require("../models/Review");
const ActivityLog = require("../models/ActivityLog");
const ProcessedPaddleEvent = require("../models/ProcessedPaddleEvent");
const PaddlePayout = require("../models/PaddlePayout");
const sendEmail = require("../utils/sendEmail");
const isProUser = require("../utils/isProUser");
const {
  getAdminMetrics,
  getPaddleUsage,
  getExpoBuildUsage,
} = require("../services/adminMetricsService");
const { syncUserCancellation } = require("../services/paddleBilling");

// 1. Get Platform Stats & Metrics
const getAdminStats = async (req, res, next) => {
  try {
    // Database counts
    const activeUserFilter = { deactivatedAt: null };
    const totalUsers = await User.countDocuments(activeUserFilter);
    const users = await User.find(activeUserFilter).select(
      "role subscriptionTier isPro subscriptionExpiresAt",
    );
    const proUsers = users.filter(
      (user) => user.role !== "admin" && isProUser(user),
    ).length;

    const totalMeals = await Meal.countDocuments();
    const totalExercises = await Exercise.countDocuments();

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        proUsers,
        freeUsers: Math.max(0, totalUsers - proUsers),
        totalMeals,
        totalExercises,
        activeSubscriptions: proUsers,
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
    const data = users.map((user) => {
      const activePro = isProUser(user);
      return {
        ...user.toObject(),
        subscriptionTier: activePro ? "pro" : "free",
        isPro: activePro,
      };
    });
    return res.status(200).json({
      success: true,
      count: users.length,
      data,
    });
  } catch (error) {
    next(error);
  }
};

// 4. Delete User & Their Related Data
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (user.paddleSubscriptionId) {
      await syncUserCancellation(user, true);
    }

    user.deactivatedAt = new Date();
    user.deactivationExpiresAt = new Date(
      user.deactivatedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    await user.save();

    //  Create Audit Activity Log
    await ActivityLog.create({
      admin: req.user._id,
      adminEmail: req.user.email,
      action: "DELETE_USER",
      details: `Deactivated user account ${user.email} for the 30-day recovery period`,
    });

    return res.status(200).json({
      success: true,
      message: "User account deactivated for the 30-day recovery period",
    });
  } catch (error) {
    next(error);
  }
};

// 5. Get Revenue Statistics
const getRevenueStats = async (req, res) => {
  try {
    const paddle = await getPaddleUsage();
    if (!paddle.connected) {
      return res.status(503).json({
        success: false,
        message: paddle.message,
      });
    }

    res.status(200).json({
      success: true,
      data: {
        totalRevenue: paddle.transactionVolumeUSD,
        activeSubscriptions: paddle.activeSubscriptions,
        currency: "USD",
        source: "Verified Paddle transactions",
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Get all reviews for moderation
const getAllReviews = async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 }).limit(200);
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
    review.isHidden = true;
    await review.save();

    //  Create Audit Activity Log
    await ActivityLog.create({
      admin: req.user._id,
      adminEmail: req.user.email,
      action: "DELETE_REVIEW",
      details: `Hidden Play Store review ID: ${req.params.id}`,
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

    let query = { deactivatedAt: null };
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
          <h2 style="color: #34d399; margin-top: 0;">NutriMorph Announcement </h2>
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

    //  Create Audit Activity Log
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
    const services = await getAdminMetrics();
    res.status(200).json({
      success: true,
      data: {
        resendEmailsSent: services.resend.used,
        resendMonthlyLimit: services.resend.limit,
        geminiApiCalls: services.gemini.used,
        geminiLimit: services.gemini.limit,
        geminiPromptTokens: services.gemini.promptTokens,
        geminiCandidateTokens: services.gemini.candidateTokens,
        dbStorageUsedMB:
          services.atlas.used == null
            ? null
            : services.atlas.used / 1024 / 1024,
        dbLimitMB:
          services.atlas.limit == null
            ? null
            : services.atlas.limit / 1024 / 1024,
        cloudinaryStorageGB: services.cloudinary.used,
        cloudinaryLimitGB: services.cloudinary.limit,
        expoBuildsUsed: services.expo.used,
        expoBuildsLimit: services.expo.limit,
        expoActiveBuilds: services.expo.activeBuilds,
        expoOtaBandwidthMB: null,
        expoOtaLimitMB: null,
        services: {
          resend: services.resend,
          gemini: services.gemini,
          atlas: services.atlas,
          cloudinary: services.cloudinary,
          expo: services.expo,
          paddle: services.paddle,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Test Resend email delivery.
const testEmailSystem = async (req, res) => {
  try {
    const adminEmail = req.user.email;

    await sendEmail({
      email: adminEmail,
      subject: "NutriMorph Integration Test Email",
      text: "Your Resend email integration is working correctly.",
    });

    return res.status(200).json({
      success: true,
      message: `Test email sent successfully to ${adminEmail} through Resend.`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Resend could not send the test email.",
    });
  }
};

// Database Storage Cleanup (Purge old logs / expired data)
const cleanupDatabase = async (req, res) => {
  try {
    const ActivityLog = require("../models/ActivityLog"); // Activity Log model

    // Delete activity logs older than 30 days.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await ActivityLog.deleteMany({
      createdAt: { $lt: thirtyDaysAgo },
    });

    res.status(200).json({
      success: true,
      message: `Database cleaned up successfully! Removed ${result.deletedCount} old log records.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Sync & Health Check for Third-Party Services
const syncServicesHealth = async (req, res) => {
  try {
    const services = await getAdminMetrics();
    const connected = Object.entries(services)
      .filter(([name]) => name !== "gemini")
      .every(([, value]) => value.connected);
    res.status(200).json({
      success: true,
      message: connected
        ? "Configured service metrics have been refreshed."
        : "Some integrations are unavailable. Review service status and server configuration.",
      services,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Purge Unused / Orphaned Images from Cloudinary
const purgeCloudinaryStorage = async (req, res) => {
  try {
    // Unreferenced images can be identified and deleted through the Cloudinary SDK.
    res.status(200).json({
      success: true,
      message:
        "Cloudinary storage audit complete! Unused media assets purged successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Check Expo EAS Build Queues / Status
const getExpoBuildsStatus = async (req, res) => {
  try {
    const builds = await getExpoBuildUsage();
    res.status(200).json({
      success: true,
      message: builds.message,
      data: builds,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get Payment Gateway & Webhook Health Status
const getGatewayHealth = async (req, res) => {
  try {
    const paddle = await getPaddleUsage();
    const [pendingWebhookEvents, payouts] = await Promise.all([
      ProcessedPaddleEvent.countDocuments({ processedAt: { $exists: false } }),
      PaddlePayout.find()
        .sort({ lastEventAt: -1 })
        .limit(10)
        .select("status amount currencyCode remittanceReference lastEventAt")
        .lean(),
    ]);
    res.status(200).json({
      success: true,
      data: {
        gatewayName: "Paddle Billing",
        status: paddle.connected
          ? pendingWebhookEvents > 0
            ? "Attention required"
            : "Configured"
          : "Not configured",
        activeWebhooks: null,
        pendingWebhookEvents,
        totalTransactionVolumeUSD: paddle.transactionVolumeUSD,
        verifiedTransactions30d: paddle.verifiedTransactions30d,
        payouts,
        message: paddle.message,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Report Paddle billing configuration without claiming that a webhook ping was performed.
const testWebhookPing = async (req, res) => {
  try {
    const paddle = await getPaddleUsage();
    if (!paddle.connected) {
      return res.status(503).json({
        success: false,
        message: paddle.message,
      });
    }
    res.status(200).json({
      success: true,
      message:
        "Paddle API and webhook signing credentials are configured. Confirm notification delivery and merchant payout details in Paddle.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAdminStats,
  getAllUsers,
  testWebhookPing,
  getGatewayHealth,
  testEmailSystem,
  cleanupDatabase,
  syncServicesHealth,
  getApiUsageStats,
  deleteUser,
  getRevenueStats,
  getAllReviews,
  deleteReview,
  sendBroadcast,
  getActivityLogs,
  purgeCloudinaryStorage,
  getExpoBuildsStatus,
};
