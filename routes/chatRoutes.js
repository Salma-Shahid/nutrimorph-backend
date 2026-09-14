const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { checkPro } = require("../middlewares/checkPro");
const { handleChat, getChatHistory } = require("../controllers/chatController");

// Ensure both handlers are valid functions
router.post("/", protect, checkPro, handleChat);
router.get("/:userId", protect, checkPro, getChatHistory);

module.exports = router;
