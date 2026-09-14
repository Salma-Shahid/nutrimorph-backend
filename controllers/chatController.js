const ChatMessage = require("../models/ChatMessage");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// handleChat logic:
const handleChat = async (req, res) => {
  try {
    const user = req.user;

    // Daily Reset Check
    const today = new Date().setHours(0, 0, 0, 0);
    const lastChatDay = new Date(user.lastChatDate || 0).setHours(0, 0, 0, 0);

    if (today > lastChatDay) {
      user.dailyChatCount = 0;
      user.lastChatDate = Date.now();
    }

    // Free User Limit Guard (Max 5 Messages/Day)
    if (user.subscriptionTier === "free" && user.dailyChatCount >= 5) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        message:
          "Aap ki daily 5 free messages ki limit khatam ho chuki hai. Pro plan par upgrade karein!",
      });
    }

    // AI API Call code yahan aye ga...

    // Increment count for free user
    if (user.subscriptionTier === "free") {
      user.dailyChatCount += 1;
      await user.save();
    }

    res.status(200).json({ success: true, response: responseText });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getChatHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const history = await ChatMessage.find({ userId }).sort({ createdAt: 1 });
    return res.status(200).json({ success: true, history });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch history" });
  }
};

// ✅ Export both functions explicitly
module.exports = {
  handleChat,
  getChatHistory,
};
