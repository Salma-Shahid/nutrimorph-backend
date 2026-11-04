const ChatMessage = require("../models/ChatMessage");
const User = require("../models/User");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const connectDB = require("../config/db");
const { callGeminiWithRetry } = require("../utils/aiHelper");
const { GEMINI_MODEL } = require("../config/ai");
const mongoose = require("mongoose");
const isProUser = require("../utils/isProUser");
const normalizeSubscription = require("../utils/normalizeSubscription");

const getUtcDayBounds = () => {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Handle incoming user chat messages with Gemini AI
 */
const handleChat = async (req, res) => {
  let freeMessageReservation = null;
  try {
    //  Ensure DB Connection First
    await connectDB();

    const { message } = req.body;
    const userId = req.user._id; // Strict Authentication Binding

    // Input Validation
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message text is required.",
      });
    }

    //  Fetch user profile strictly by authenticated userId
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found in the system.",
      });
    }

    await normalizeSubscription(user);
    const currentTier = (user.subscriptionTier || "free").toLowerCase();
    const isFreeTier = !isProUser(user);
    const { start, end } = getUtcDayBounds();
    const now = new Date();

    if (isFreeTier) {
      const newDayReservation = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { lastChatDate: { $lt: start } },
          { lastChatDate: { $exists: false } },
          { lastChatDate: null },
        ],
      },
      { $set: { dailyChatCount: 1, lastChatDate: now } },
      { new: true },
      );
      const sameDayReservation =
      newDayReservation ||
      (await User.findOneAndUpdate(
        {
          _id: userId,
          lastChatDate: { $gte: start, $lt: end },
          $or: [
            { dailyChatCount: { $lt: 1 } },
            { dailyChatCount: { $exists: false } },
          ],
        },
        { $inc: { dailyChatCount: 1 } },
        { new: true },
      ));

      if (!sameDayReservation) {
      return res.status(403).json({
        success: false,
        limitReached: true,
        code: "TRIAL_REQUIRED",
        reply:
          "Your free NutriBot message for today has been used. Start a 3-day free trial for unlimited AI support.",
        message:
          "Your free NutriBot message for today has been used. Start a 3-day free trial for unlimited AI support.",
        remainingChats: 0,
      });
      }
      freeMessageReservation = { userId, start, end };
      user.dailyChatCount = sameDayReservation.dailyChatCount;
      user.lastChatDate = sameDayReservation.lastChatDate;
    }

    // User Context Grounding
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

    //  Fetch recent chat history strictly isolated to this user
    const rawHistory = await ChatMessage.find({ user: userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10);

    // Truncate long messages (>400 chars) to save Gemini API token costs
    const formattedHistory = rawHistory.reverse().map((msg) => {
      const msgText = msg.text || "";
      const truncatedText =
        msgText.length > 400 ? msgText.substring(0, 400) + "..." : msgText;

      return {
        role: msg.role === "bot" || msg.sender === "bot" ? "model" : "user",
        parts: [{ text: truncatedText }],
      };
    });

    const geminiModel = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: `You are NutriBot, an expert AI nutritionist and fitness coach for the NutriMorph application.
Communicate warmly and professionally in Standard English only. Never respond in Urdu, Roman Urdu, or mixed-language text, even if the user requests it.

GROUND TRUTH USER PROFILE CONTEXT:
${userProfileContext}

STRICT INSTRUCTIONS:
1. Ground Truth Rules: Always strictly adhere to the subscription plan and metrics given in the user profile context.
2. Domain Scope: Keep responses focused strictly on diet, nutrition, macro tracking, meal planning, workouts, and recipes.
3. Personalization: Use the user's name, daily calorie goal, weight, height, and target goals naturally.
4. Tone & Style: Be encouraging, concise, informative, and clear in English.
5. Avoid Speculation: Do not provide medical advice, diagnoses, or treatment plans. Refer users to certified professionals for health concerns.
6. No Sensitive Data: Do not request or store sensitive personal information.
7. No External Links: Do not provide external links or references.`,
    });

    // Start Chat Session
    const chatSession = geminiModel.startChat({
      history: formattedHistory,
    });

    // Call Gemini with Exponential Backoff Retry Wrapper
    const result = await callGeminiWithRetry(async () => {
      return await chatSession.sendMessage(message.trim());
    });

    const responseText = result.response.text();

    //  Save user & bot messages strictly bound to user._id
    const userMsgDoc = await ChatMessage.create({
      user: userId,
      role: "user",
      sender: "user",
      text: message.trim(),
    });

    const botMsgDoc = await ChatMessage.create({
      user: userId,
      role: "bot",
      sender: "bot",
      text: responseText.trim(),
    });

    return res.status(200).json({
      success: true,
      reply: responseText,
      response: responseText,
      userMessage: userMsgDoc,
      botMessage: botMsgDoc,
      dailyChatCount: user.dailyChatCount,
      remainingChats: isFreeTier
        ? Math.max(0, 1 - user.dailyChatCount)
        : "unlimited",
      usageDate: start.toISOString().slice(0, 10),
    });
  } catch (error) {
    if (freeMessageReservation) {
      try {
        await User.updateOne(
          {
            _id: freeMessageReservation.userId,
            lastChatDate: {
              $gte: freeMessageReservation.start,
              $lt: freeMessageReservation.end,
            },
            dailyChatCount: { $gt: 0 },
          },
          { $inc: { dailyChatCount: -1 } },
        );
      } catch (reservationError) {
        console.error(
          "Could not restore the free chat allowance after a failed response:",
          reservationError,
        );
      }
    }
    console.error("Error in handleChat controller:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "An unexpected internal server error occurred.",
    });
  }
};

/**
 * Fetch Chat History strictly isolated for authenticated user
 */
const getChatHistory = async (req, res) => {
  try {
    await connectDB();

    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated." });
    }

    const limit = Math.min(
      50,
      Math.max(1, Math.floor(Number(req.query.limit) || 30)),
    );
    const filter = { user: userId };
    if (req.query.before) {
      const cursorId = String(req.query.before);
      if (!mongoose.Types.ObjectId.isValid(cursorId)) {
        return res.status(400).json({
          success: false,
          message: "The chat history cursor is invalid.",
        });
      }
      const cursor = await ChatMessage.findOne({
        _id: cursorId,
        user: userId,
      }).select("createdAt");
      if (!cursor) {
        return res.status(400).json({
          success: false,
          message: "The chat history cursor is no longer available.",
        });
      }
      filter.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
      ];
    }

    const page = await ChatMessage.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);
    const hasMore = page.length > limit;
    const history = page.slice(0, limit).reverse();

    return res.status(200).json({
      success: true,
      history,
      hasMore,
      nextCursor: hasMore ? history[0]?._id : null,
    });
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
