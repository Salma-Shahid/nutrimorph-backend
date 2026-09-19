const ChatMessage = require("../models/ChatMessage");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Google Generative AI
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

    // Construct User Profile Details with fallbacks
    const userProfileContext = [
      `User Name: ${user.name || user.username || "Member"}`,
      `Subscription Plan: ${user.subscriptionTier || "free"}`,
      `Primary Goal: ${user.goal || user.fitnessGoal || "General Fitness & Health"}`,
      `Daily Calorie Target: ${user.dailyCalorieTarget || user.calorieTarget || user.dailyCalorieGoal || user.dailyCalories || "Not set"} kcal`,
      `Dietary Preferences: ${user.dietaryPreferences || user.dietType || "None specified"}`,
      `Current Weight: ${user.weight ? `${user.weight} kg` : "Not provided"}`,
      `Height: ${user.height ? `${user.height} cm` : "Not provided"}`,
    ].join("\n");

    // Valid Gemini Model fallback (gemini-3.5-flash-lite)
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
      {
        user: userId,
        userId: userId,
        role: "user",
        sender: "user",
        text: message.trim(),
      },
      {
        user: userId,
        userId: userId,
        role: "bot",
        sender: "bot",
        text: responseText.trim(),
      },
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
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    // Query both 'user' and 'userId' fields for backwards compatibility
    const history = await ChatMessage.find({
      $or: [{ user: userId }, { userId: userId }],
    }).sort({ createdAt: 1 });

    return res.status(200).json({ history: history || [] });
  } catch (error) {
    console.error("Error fetching chat history:", error.message);
    return res.status(500).json({
      message: "Failed to load chat history",
      error: error.message,
    });
  }
};

module.exports = {
  handleChat,
  getChatHistory,
};
