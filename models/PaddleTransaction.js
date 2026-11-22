const mongoose = require("mongoose");

const paddleTransactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subscriptionId: { type: String, default: null, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, lowercase: true },
    paidAt: { type: Date, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PaddleTransaction", paddleTransactionSchema);
