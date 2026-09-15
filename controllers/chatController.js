const ChatMessage = require("../models/ChatMessage");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Google Generative AI with your environment API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Handle Chat Logic
const handleChat = async (req, res) => {
  try {
    const user = req.user;
    const { message, model } = req.body;

    // Input Validation
    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "Message text is required.",
      });
    }

    // Daily Reset Check for Chat Allowance
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
          "Your daily limit of 5 free messages has been reached. Upgrade to the Pro plan for unlimited messaging!",
      });
    }

    // Construct User Profile Details for AI Context
    const userProfileContext = [
      `User Name: ${user.name || user.username || "Member"}`,
      `Subscription Plan: ${user.subscriptionTier || "free"}`,
      `Primary Goal: ${user.goal || user.fitnessGoal || "General Fitness & Health"}`,
      `Daily Calorie Target: ${user.dailyCalorieTarget || user.calorieTarget || "Not set"} kcal`,
      `Dietary Preferences: ${user.dietaryPreferences || user.dietType || "None specified"}`,
      `Current Weight: ${user.weight ? `${user.weight} kg` : "Not provided"}`,
      `Height: ${user.height ? `${user.height} cm` : "Not provided"}`,
    ].join("\n");

    // Execute AI API Call using gemini-3.5-flash-lite
    const selectedModel = model || "gemini-3.5-flash-lite";
    const geminiModel = genAI.getGenerativeModel({
      model: selectedModel,
      systemInstruction: `You are NutriBot, an expert AI nutritionist and fitness coach. Provide concise advice focused strictly on diet, macro tracking, meal planning, and recipes.

Current User Context:
${userProfileContext}

Personalize your responses using the user context above. When the user asks "Do you know me?" or inquires about their profile, state their details naturally and warmly.`,
    });

    const result = await geminiModel.generateContent(message);
    const responseText = result.response.text();

    // Increment chat count for free tier users
    if (user.subscriptionTier === "free") {
      user.dailyChatCount += 1;
    }
    await user.save();

    // Persist User & Bot Messages in MongoDB Chat History
    const userId = user._id || user.id;
    await ChatMessage.create([
      { userId, sender: "user", text: message.trim() },
      { userId, sender: "bot", text: responseText.trim() },
    ]);

    // Send unified success response back to frontend
    return res.status(200).json({
      success: true,
      reply: responseText,
      response: responseText,
      dailyChatCount: user.dailyChatCount,
      remainingChats:
        user.subscriptionTier === "free"
          ? 5 - user.dailyChatCount
          : "unlimited",
    });
  } catch (error) {
    console.error("Error in handleChat controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "An unexpected internal server error occurred.",
    });
  }
};

// Fetch Chat History Logic
const getChatHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID parameter is required.",
      });
    }

    const history = await ChatMessage.find({ userId }).sort({ createdAt: 1 });
    return res.status(200).json({ success: true, history });
  } catch (error) {
    console.error("Error in getChatHistory controller:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch chat history.",
    });
  }
};

// Export controller functions
module.exports = {
  handleChat,
  getChatHistory,
};
