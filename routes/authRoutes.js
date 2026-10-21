const express = require("express");
const router = express.Router();
const {
  register,
  verifyEmail,
  login,
  getMe,
  updateProfile,
  completeOnboarding, // 🟢 Import Onboarding Controller
  deleteAccount,
} = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");

router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/login", login);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);

// 🟢 Onboarding Endpoint
router.post("/onboarding", protect, completeOnboarding);

// 🔴 Account Deletion Endpoint (Google Play Compliance P0)
router.delete("/me", protect, deleteAccount);
router.get("/profile", protect, getMe);

module.exports = router;
