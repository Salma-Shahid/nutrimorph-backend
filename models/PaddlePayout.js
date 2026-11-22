const mongoose = require("mongoose");

const paddlePayoutSchema = new mongoose.Schema(
  {
    paddlePayoutId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["unpaid", "paid"], required: true },
    remittanceReference: { type: String, default: null },
    amount: { type: Number, required: true },
    currencyCode: { type: String, required: true, lowercase: true },
    lastEventAt: { type: Date, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PaddlePayout", paddlePayoutSchema);
