const express = require("express");
const router = express.Router();
const {
  register,
  verifyEmail,
  login,
  getMe,
  updateProfile,
  deleteAccount, // 🟢 Delete Account Import
} = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");

router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/login", login);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);

// 🔴 Account Deletion Endpoint (Google Play Compliance P0)
router.delete("/me", protect, deleteAccount);

module.exports = router;
