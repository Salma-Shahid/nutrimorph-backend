const express = require("express");
const router = express.Router();
const {
  register,
  verifyEmail,
  login,
  requestPasswordReset,
  resetPassword,
  getMe,
  updateProfile,
  completeOnboarding, //  Import Onboarding Controller
  deleteAccount,
  requestAccountDeletion,
  confirmAccountDeletion,
} = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");
const { emailLimiter } = require("../middlewares/rateLimiter");

router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/login", login);
router.post("/forgot-password", requestPasswordReset);
router.post("/reset-password", resetPassword);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);

//  Onboarding Endpoint
router.post("/onboarding", protect, completeOnboarding);

//  Account Deletion Endpoint (Google Play Compliance P0)
router.delete("/me", protect, deleteAccount);
// Website deletion flow: email a confirmation link, then confirm with token.
router.post("/delete-request", emailLimiter, requestAccountDeletion);
router.post("/delete-confirm", confirmAccountDeletion);

module.exports = router;
