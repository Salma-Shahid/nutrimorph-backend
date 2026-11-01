const express = require("express");
const router = express.Router();
const {
  getAdminStats,
  getAllUsers,
  updateUserTier,
  deleteUser,
} = require("../controllers/adminController");
const { protect } = require("../middlewares/authMiddleware");
const requireAdmin = require("../middlewares/adminMiddleware");

// All admin routes require authentication + admin role
router.use(protect, requireAdmin);

router.get("/stats", getAdminStats);
router.get("/users", getAllUsers);
router.patch("/users/:id/tier", updateUserTier);
router.delete("/users/:id", deleteUser);

module.exports = router;
