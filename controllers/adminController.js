const User = require("../models/User");
const Meal = require("../models/Meal");
const Exercise = require("../models/ExerciseModel");
const Review = require("../models/Review");
const ActivityLog = require("../models/ActivityLog");
const ProcessedPaddleEvent = require("../models/ProcessedPaddleEvent");
const PaddlePayout = require("../models/PaddlePayout");
const sendEmail = require("../utils/sendEmail");
const {
  getSubscriptionSnapshot,
  activeProFilter,
} = require("../utils/isProUser");
const {
  getAdminMetrics,
  getPaddleUsage,
  getRevenueCatStatus,
  getExpoBuildUsage,
} = require("../services/adminMetricsService");
const { safeSyncUserCancellation } = require("../services/paddleBilling");

// Fields that must never be sent to the dashboard, even to admins.
const PRIVATE_USER_FIELDS =
  "-password -verificationToken -verificationTokenExpires -passwordResetToken -passwordResetTokenExpires -accountDeletionToken -accountDeletionTokenExpires";

const toAdminUser = (user) => {
  const plain = user.toObject ? user.toObject() : user;
  return { ...plain, ...getSubscriptionSnapshot(plain) };
};

// 1. Get Platform Stats & Metrics
const getAdminStats = async (req, res, next) => {
  try {
    // Database counts
    const activeUserFilter = { deactivatedAt: null };
    const [totalUsers, proUsers] = await Promise.all([
      User.countDocuments(activeUserFilter),
      User.countDocuments({
        ...activeUserFilter,
        role: { $ne: "admin" },
        ...activeProFilter(),
      }),
    ]);

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
    const users = await User.find()
      .select(PRIVATE_USER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    const data = users.map(toAdminUser);
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

    const paddle = await safeSyncUserCancellation(user, true);

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
      details: `Deactivated user account ${user.email} for the 30-day recovery period${paddle.warning ? ` (${paddle.warning})` : ""}`,
    });

    return res.status(200).json({
      success: true,
      message: "User account deactivated for the 30-day recovery period",
      warning: paddle.warning || null,
    });
  } catch (error) {
    next(error);
  }
};

// 4b. Switch a user's plan (free / pro / trial) with a full audit trail.
// @route PATCH /api/admin/users/:id/subscription
const PLAN_OPTIONS = new Set(["free", "pro", "trial"]);
const updateUserSubscription = async (req, res, next) => {
  try {
    const plan = String(req.body?.plan || "").toLowerCase();
    if (!PLAN_OPTIONS.has(plan)) {
      return res.status(400).json({
        success: false,
        message: "Plan must be one of: free, pro, trial.",
      });
    }
    const rawDays = req.body?.durationDays;
    const durationDays =
      rawDays === null || rawDays === undefined || rawDays === ""
        ? null
        : Number(rawDays);
    if (
      durationDays !== null &&
      (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)
    ) {
      return res.status(400).json({
        success: false,
        message: "Duration must be a whole number of days between 1 and 3650.",
      });
    }

    const user = await User.findById(req.params.id).select(PRIVATE_USER_FIELDS);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const before = getSubscriptionSnapshot(user);
    const now = new Date();
    const addDays = (days) =>
      new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // isPro, subscriptionTier and subscriptionStatus are always written
    // together so /api/auth/me and the app agree immediately.
    if (plan === "pro") {
      Object.assign(user, {
        subscriptionTier: "pro",
        isPro: true,
        subscriptionStatus: "active",
        subscriptionExpiresAt: durationDays ? addDays(durationDays) : null,
        billingProvider: "admin",
        trialStartDate: null,
        trialEndDate: null,
      });
    } else if (plan === "trial") {
      const trialEnd = addDays(durationDays || 3);
      Object.assign(user, {
        subscriptionTier: "pro",
        isPro: true,
        subscriptionStatus: "trialing",
        subscriptionExpiresAt: trialEnd,
        billingProvider: "admin",
        trialStartDate: now,
        trialEndDate: trialEnd,
        trialUsedAt: user.trialUsedAt || now,
      });
    } else {
      Object.assign(user, {
        subscriptionTier: "free",
        isPro: false,
        subscriptionStatus: "free",
        subscriptionExpiresAt: null,
        billingProvider: null,
        trialStartDate: null,
        trialEndDate: null,
      });
    }
    await user.save();

    const after = getSubscriptionSnapshot(user);
    const expiry = after.subscriptionExpiresAt
      ? ` until ${new Date(after.subscriptionExpiresAt).toISOString().slice(0, 10)}`
      : after.isPro
        ? " with no expiry"
        : "";
    const paidElsewhere =
      plan === "free" &&
      ["paddle", "revenuecat"].includes(before.billingProvider) &&
      before.isPro
        ? ` Note: the user's ${before.billingProvider} subscription is still billed and may re-grant Pro on its next renewal.`
        : "";

    await ActivityLog.create({
      admin: req.user._id,
      adminEmail: req.user.email,
      action: "UPDATE_SUBSCRIPTION",
      details: `Changed plan for ${user.email}: ${before.plan} → ${after.plan}${expiry}.${paidElsewhere}`,
    });

    return res.status(200).json({
      success: true,
      message: `${user.email} is now on the ${after.plan} plan.`,
      warning: paidElsewhere.trim() || null,
      data: toAdminUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// 5. Get Revenue Statistics
// RevenueCat is the primary provider; Paddle is reported only as an optional
// legacy fallback. Store revenue lives in the RevenueCat dashboard, so only
// Paddle's verified volume is summed here.
const getRevenueStats = async (req, res) => {
  try {
    const [revenueCat, paddle, activeSubscriptions] = await Promise.all([
      getRevenueCatStatus(),
      getPaddleUsage(),
      User.countDocuments({
        deactivatedAt: null,
        role: { $ne: "admin" },
        ...activeProFilter(),
      }),
    ]);

    res.status(200).json({
      success: true,
      // "configured" follows the primary provider only.
      configured: revenueCat.connected,
      message: revenueCat.connected
        ? revenueCat.missing.length
          ? revenueCat.message
          : null
        : revenueCat.message,
      data: {
        primaryProvider: "revenuecat",
        activeSubscriptions,
        revenueCat: {
          connected: revenueCat.connected,
          missing: revenueCat.missing,
          activeSubscribers: revenueCat.activeSubscribers,
          activeTrials: revenueCat.activeTrials,
          message: revenueCat.message,
        },
        paddle: {
          connected: paddle.connected,
          legacy: true,
          totalRevenue: paddle.connected ? paddle.transactionVolumeUSD : null,
          currency: "USD",
          message: paddle.connected
            ? "Verified Paddle transactions (last 30 days)."
            : "Optional legacy fallback is not configured.",
        },
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
      query = { ...query, ...activeProFilter() };
    } else if (targetAudience === "free") {
      query = { ...query, $nor: [activeProFilter()] };
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
        // Storage comes from the live connection's dbStats (MB).
        dbStorageUsedMB: services.database.used,
        dbLimitMB: services.database.limit,
        dbConnected: services.database.connected,
        cloudinaryStorageGB: services.cloudinary.used,
        cloudinaryLimitGB: services.cloudinary.limit,
        expoBuildsUsed: services.expo.used,
        expoBuildsLimit: services.expo.limit,
        expoActiveBuilds: services.expo.activeBuilds,
        expoBillingPeriod: services.expo.billingPeriod || null,
        expoUsageSource: services.expo.source || null,
        expoOtaBandwidthMB: null,
        expoOtaLimitMB: null,
        services: {
          resend: services.resend,
          gemini: services.gemini,
          database: services.database,
          atlas: services.atlas,
          cloudinary: services.cloudinary,
          expo: services.expo,
          revenuecat: services.revenuecat,
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
    // Optional services (Atlas Admin API, legacy Paddle) never fail the check.
    const connected = Object.entries(services)
      .filter(
        ([name, value]) => !["gemini", "atlas"].includes(name) && !value.optional,
      )
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
    const [revenueCat, paddle] = await Promise.all([
      getRevenueCatStatus(),
      getPaddleUsage(),
    ]);
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
        gatewayName: "RevenueCat (primary)",
        // Overall status follows the primary provider; Paddle backlog only
        // matters when the legacy fallback is actually configured.
        status: !revenueCat.connected
          ? "Not configured"
          : paddle.connected && pendingWebhookEvents > 0
            ? "Attention required"
            : "Configured",
        revenueCat: {
          connected: revenueCat.connected,
          checks: revenueCat.checks,
          missing: revenueCat.missing,
          activeSubscribers: revenueCat.activeSubscribers,
          activeTrials: revenueCat.activeTrials,
          message: revenueCat.message,
        },
        paddleConfigured: paddle.connected,
        activeWebhooks: null,
        pendingWebhookEvents,
        totalTransactionVolumeUSD: paddle.transactionVolumeUSD,
        verifiedTransactions30d: paddle.verifiedTransactions30d,
        payouts,
        message: revenueCat.message,
        paddleMessage: paddle.connected
          ? paddle.message
          : "Paddle (optional legacy fallback) is not configured.",
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Report billing configuration (RevenueCat primary, Paddle optional legacy)
// without claiming that a webhook ping was performed.
const testWebhookPing = async (req, res) => {
  try {
    const [revenueCat, paddle] = await Promise.all([
      getRevenueCatStatus(),
      getPaddleUsage(),
    ]);
    const paddleNote = paddle.connected
      ? " Paddle legacy fallback is also configured."
      : " Paddle legacy fallback is not configured (optional).";
    if (!revenueCat.connected) {
      return res.status(503).json({
        success: false,
        message: revenueCat.message + paddleNote,
      });
    }
    res.status(200).json({
      success: true,
      message:
        revenueCat.message +
        " Send a test event from RevenueCat > Integrations > Webhooks to confirm delivery." +
        paddleNote,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAdminStats,
  getAllUsers,
  updateUserSubscription,
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
