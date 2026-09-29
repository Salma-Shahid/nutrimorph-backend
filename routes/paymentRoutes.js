const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const User = require("../models/User");
const { protect } = require("../middlewares/authMiddleware");

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_dev";
const stripe = Stripe(stripeKey);

// 1. Create Checkout Session
router.post("/create-checkout-session", protect, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({
        message: "Stripe API Key missing on server.",
      });
    }

    const { plan, billingCycle } = req.body; // Frontend se plan aur cycle receive karein

    const isYearly = billingCycle === "yearly";
    const unitAmount = isYearly ? 9900 : 999; // $99/yr ya $9.99/mo
    const interval = isYearly ? "year" : "month";

    const serverUrl =
      process.env.SERVER_URL ||
      `${req.protocol}://${req.get("host")}` ||
      "https://nutrimorph-backend.vercel.app";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `NutriMorph Pro Nutritionist (${isYearly ? "Yearly" : "Monthly"})`,
              description: "Unlimited AI Chat, Camera Scanner & Analytics",
            },
            unit_amount: unitAmount,
            recurring: { interval: interval },
          },
          quantity: 1,
        },
      ],
      customer_email: req.user.email,
      success_url: `${serverUrl}/api/payment/success?userId=${req.user._id}&billing=${billingCycle}`,
      cancel_url: `${serverUrl}/api/payment/cancel`,
    });

    res.json({ success: true, url: session.url, id: session.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2. Success Redirect (MongoDB Auto Update)
router.get("/success", async (req, res) => {
  try {
    const { userId, billing } = req.query;

    if (userId) {
      const days = billing === "yearly" ? 365 : 30;
      await User.findByIdAndUpdate(userId, {
        subscriptionTier: "pro",
        subscriptionExpiresAt: new Date(
          Date.now() + days * 24 * 60 * 60 * 1000,
        ),
      });
    }

    res.send(`
      <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; height: 100vh;">
        <h1 style="color: #22c55e;">🎉 Payment Successful!</h1>
        <p style="font-size: 18px; color: #cbd5e1;">Your Pro Plan is now active.</p>
        <p style="color: #94a3b8;">You can close this window and restart the app.</p>
      </div>
    `);
  } catch (error) {
    res.status(500).send("Database Update Failed");
  }
});

// 3. Cancel Route
router.get("/cancel", (req, res) => {
  res.send(`
    <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; height: 100vh;">
      <h1 style="color: #ef4444;">❌ Payment Cancelled</h1>
      <p style="font-size: 18px; color: #cbd5e1;">Your payment was cancelled.</p>
    </div>
  `);
});

// 4. Direct Verify Route
router.post("/verify-payment", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 5. Downgrade / Switch to Free Plan
router.post("/switch-to-free", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.subscriptionTier = "free";
    user.subscriptionExpiresAt = null;
    await user.save();

    res.json({
      success: true,
      message: "Switched to Free Plan successfully!",
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
