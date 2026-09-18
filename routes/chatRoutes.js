const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { handleChat, getChatHistory } = require("../controllers/chatController");

// POST /api/chat - Send chat message
router.post("/", protect, handleChat);

// GET /api/chat/history - Fetch logged in user's chat history
router.get("/history", protect, getChatHistory);

// GET /api/chat/:userId - Optional fallback route with param
router.get("/:userId", protect, getChatHistory);

module.exports = router;
