const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  // 💳 Subscription Fields
  subscriptionTier: {
    type: String,
    enum: ["free", "pro"],
    default: "free",
  },
  subscriptionExpiresAt: { type: Date },

  // 🤖 Free Limits Tracking
  dailyChatCount: { type: Number, default: 0 },
  lastChatDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);
