const ChatMessage = require("../models/ChatMessage");
const User = require("../models/User");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const connectDB = require("../config/db"); // 🟢 Database Connection Import

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Handle incoming user chat messages with Gemini AI
 */
const handleChat = async (req, res) => {
  try {
    // 🟢 Ensure MongoDB is connected first
    await connectDB();

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

    // Fetch fresh user data directly from MongoDB
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

    // Construct User Profile Details Context (Safe Optional Fallbacks)
    const userProfileContext = [
      `User Name: ${user.name || user.username || "Member"}`,
      `Subscription Plan: ${currentTier.toUpperCase()} (${isFreeTier ? "Free Tier Plan" : "Pro Plan Active"})`,
      `Primary Goal: ${user.goal || user.fitnessGoal || "General Fitness & Health"}`,
      `Daily Calorie Target: ${
        user.dailyCalorieTarget ||
        user.calorieTarget ||
        user.dailyCalorieGoal ||
        user.dailyCalories ||
        "2000"
      } kcal`,
      `Dietary Preferences: ${user.dietaryPreferences || user.dietType || "None specified"}`,
      `Current Weight: ${user.weight ? `${user.weight} kg` : "Not provided"}`,
      `Height: ${user.height ? `${user.height} cm` : "Not provided"}`,
    ].join("\n");

    // Fetch recent chat history from MongoDB
    const recentMessages = await ChatMessage.find({
      $or: [{ user: userId }, { userId: userId }],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10);

    // Format chat history for Gemini chat API structure
    const formattedHistory = recentMessages.reverse().map((msg) => ({
      role: msg.role === "bot" || msg.sender === "bot" ? "model" : "user",
      parts: [{ text: msg.text }],
    }));

    // Configure Gemini AI Model
    const selectedModel = model || "gemini-1.5-flash";
    const geminiModel = genAI.getGenerativeModel({
      model: selectedModel,
      systemInstruction: `You are NutriBot, an expert AI nutritionist and fitness coach for the NutriMorph application.
Communicate warmly and professionally in English.

GROUND TRUTH USER PROFILE CONTEXT:
${userProfileContext}

STRICT INSTRUCTIONS:
1. Ground Truth Rules: Always strictly adhere to the subscription plan and metrics given in the user profile context.
2. Domain Scope: Keep responses focused strictly on diet, nutrition, macro tracking, meal planning, workouts, and recipes.
3. Personalization: Use the user's name, daily calorie goal, weight, height, and target goals naturally.
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

    // Save user & bot messages sequentially
    const userMsgDoc = await ChatMessage.create({
      user: userId,
      userId: userId,
      role: "user",
      sender: "user",
      text: message.trim(),
    });

    const botMsgDoc = await ChatMessage.create({
      user: userId,
      userId: userId,
      role: "bot",
      sender: "bot",
      text: responseText.trim(),
    });

    // Return unified success payload
    return res.status(200).json({
      success: true,
      reply: responseText,
      response: responseText,
      userMessage: userMsgDoc,
      botMessage: botMsgDoc,
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
 * Fetch Chat History for authenticated user
 */
const getChatHistory = async (req, res) => {
  try {
    // 🟢 Ensure MongoDB is connected
    await connectDB();

    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated." });
    }

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
