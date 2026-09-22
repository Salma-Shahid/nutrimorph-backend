const ChatMessage = require("../models/ChatMessage");
const User = require("../models/User");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Handle incoming user chat messages with Gemini AI
 */
const handleChat = async (req, res) => {
  try {
    const rawUser = req.user;
    const { message, model } = req.body;

    // Input Validation
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message text is required.",
      });
    }

    const userId = rawUser._id || rawUser.id;

    // Fetch fresh user data directly from MongoDB to guarantee accurate subscription and profile state
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found in the system.",
      });
    }

    // Daily Reset Check for Free Chat Allowance
    const today = new Date().setHours(0, 0, 0, 0);
    const lastChatDay = new Date(user.lastChatDate || 0).setHours(0, 0, 0, 0);

    if (today > lastChatDay) {
      user.dailyChatCount = 0;
      user.lastChatDate = Date.now();
    }

    // Free User Limit Guard (Max 5 Messages/Day)
    const currentTier = (user.subscriptionTier || "free").toLowerCase();
    const isFreeTier = currentTier === "free";

    if (isFreeTier && user.dailyChatCount >= 5) {
      const limitMsg =
        "Your daily limit of 5 free messages has been reached. Upgrade to the Pro plan for unlimited messaging!";

      return res.status(200).json({
        success: false,
        limitReached: true,
        reply: limitMsg,
        message: limitMsg,
        remainingChats: 0,
      });
    }

    // Construct User Profile Details Context (Ground Truth Data)
    const userProfileContext = [
      `User Name: ${user.name || user.username || "Member"}`,
      `Subscription Plan: ${currentTier.toUpperCase()} (${isFreeTier ? "Free Tier Plan" : "Pro Plan Active"})`,
      `Primary Goal: ${user.goal || user.fitnessGoal || "General Fitness & Health"}`,
      `Daily Calorie Target: ${
        user.dailyCalorieTarget ||
        user.calorieTarget ||
        user.dailyCalorieGoal ||
        user.dailyCalories ||
        "Not set"
      } kcal`,
      `Dietary Preferences: ${user.dietaryPreferences || user.dietType || "None specified"}`,
      `Current Weight: ${user.weight ? `${user.weight} kg` : "Not provided"}`,
      `Height: ${user.height ? `${user.height} cm` : "Not provided"}`,
    ].join("\n");

    // Fetch recent chat history from MongoDB for multi-turn conversational context (Last 10 messages)
    // Deterministic sorting with createdAt and _id
    const recentMessages = await ChatMessage.find({
      $or: [{ user: userId }, { userId: userId }],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10);

    // Format chat history for Gemini chat API structure (oldest to newest)
    const formattedHistory = recentMessages.reverse().map((msg) => ({
      role: msg.role === "bot" || msg.sender === "bot" ? "model" : "user",
      parts: [{ text: msg.text }],
    }));

    // Configure Gemini AI Model (Defaulting to gemini-3.5-flash-lite)
    const selectedModel = model || "gemini-3.5-flash-lite";
    const geminiModel = genAI.getGenerativeModel({
      model: selectedModel,
      systemInstruction: `You are NutriBot, an expert AI nutritionist and fitness coach for the NutriMorph application.
Communicate warmly and professionally in English.

GROUND TRUTH USER PROFILE CONTEXT:
${userProfileContext}

STRICT INSTRUCTIONS:
1. Ground Truth Rules: Always strictly adhere to the subscription plan and metrics given in the user profile context. If the user's plan is "FREE", NEVER state they are on "Pro". If they ask about their current plan or profile, report the context details accurately.
2. Domain Scope: Keep responses focused strictly on diet, nutrition, macro tracking, meal planning, workouts, and recipes.
3. Personalization: Use the user's name, daily calorie goal, weight, height, and target goals naturally to personalize your advice.
4. Tone & Style: Be encouraging, concise, informative, and clear in English.`,
    });

    // Start Chat session with formatted conversation history
    const chatSession = geminiModel.startChat({
      history: formattedHistory,
    });

    const result = await chatSession.sendMessage(message.trim());
    const responseText = result.response.text();

    // Increment chat usage count for free tier users
    if (isFreeTier) {
      user.dailyChatCount += 1;
    }
    await user.save();

    // Sequential document creation ensures exact timestamp and ObjectId sequence
    await ChatMessage.create({
      user: userId,
      userId: userId,
      role: "user",
      sender: "user",
      text: message.trim(),
    });

    await ChatMessage.create({
      user: userId,
      userId: userId,
      role: "bot",
      sender: "bot",
      text: responseText.trim(),
    });

    // Return unified success payload to frontend
    return res.status(200).json({
      success: true,
      reply: responseText,
      response: responseText,
      dailyChatCount: user.dailyChatCount,
      remainingChats: isFreeTier
        ? Math.max(0, 5 - user.dailyChatCount)
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

/**
 * Fetch Chat History for authenticated user in strict chronological order
 */
const getChatHistory = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated." });
    }

    // Strict chronological sort using createdAt and _id fallback
    const history = await ChatMessage.find({
      $or: [{ user: userId }, { userId: userId }],
    }).sort({ createdAt: 1, _id: 1 });

    return res.status(200).json({ history: history || [] });
  } catch (error) {
    console.error("Error fetching chat history:", error.message);
    return res.status(500).json({
      message: "Failed to load chat history.",
      error: error.message,
    });
  }
};

module.exports = {
  handleChat,
  getChatHistory,
};
