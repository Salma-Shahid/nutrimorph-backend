const mongoose = require("mongoose");

// Audit trail for every gem balance change (grants, ad rewards, revives).
const gemTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["monthly_grant", "ad_reward", "streak_revive"],
      required: true,
    },
    amount: { type: Number, required: true }, // + earned, - spent
    balanceAfter: { type: Number, required: true },
    meta: { type: Object, default: {} },
  },
  { timestamps: true },
);

module.exports = mongoose.model("GemTransaction", gemTransactionSchema);
