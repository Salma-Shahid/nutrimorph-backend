const express = require("express");
const router = express.Router();

const {
  getAdminStats,
  getAllUsers,
  updateUserTier,
  deleteUser,
  getRevenueStats,
  getAllReviews,
  deleteReview,
  sendBroadcast,
  getActivityLogs,
  getApiUsageStats,
  testEmailSystem,
  cleanupDatabase,
  syncServicesHealth,
} = require("../controllers/adminController");

const { protect } = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/adminMiddleware");

// All admin routes require authentication + admin role
router.use(protect, requireAdmin);

router.get("/stats", getAdminStats);
router.get("/users", getAllUsers);
router.get("/revenue", getRevenueStats); // ✅ Added new route for revenue
router.patch("/users/:id/tier", updateUserTier);
router.delete("/users/:id", deleteUser);
// Review moderation routes
router.get("/reviews", getAllReviews);
router.delete("/reviews/:id", deleteReview);
// Broadcast route
router.post("/broadcast", sendBroadcast);
// Activity logs route
router.get("/logs", getActivityLogs);
// API usage stats route
router.get("/api-stats", getApiUsageStats);

router.post("/test-email", testEmailSystem);
router.post("/cleanup-db", cleanupDatabase);
router.post("/sync-services", syncServicesHealth);

module.exports = router;
