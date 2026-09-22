const express = require("express");
const router = express.Router();
const {
  register,
  verifyEmail,
  login,
  getMe,
  updateProfile,
} = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");

router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/login", login);
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);

module.exports = router;
