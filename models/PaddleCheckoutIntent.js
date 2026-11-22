const mongoose = require("mongoose");

const paddleCheckoutIntentSchema = new mongoose.Schema(
  {
    intentId: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true },
    billingCycle: { type: String, enum: ["monthly", "yearly"], required: true },
    priceId: { type: String, required: true },
    transactionId: { type: String, default: null },
    subscriptionId: { type: String, default: null },
    completedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "PaddleCheckoutIntent",
  paddleCheckoutIntentSchema,
);
