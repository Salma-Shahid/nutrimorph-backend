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

    // Dynamic Server URL (Vercel ya Local Host)
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
              name: "NutriMorph Pro Nutritionist",
              description: "Unlimited AI Chat, Camera Scanner & Analytics",
            },
            unit_amount: 999,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      customer_email: req.user.email,
      success_url: `${serverUrl}/api/payment/success?userId=${req.user._id}`,
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
    const { userId } = req.query;

    if (userId) {
      await User.findByIdAndUpdate(userId, {
        subscriptionTier: "pro",
        subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 Days
      });
    }

    res.send(`
      <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
        <h1 style="color: #22c55e;">🎉 Payment Successful!</h1>
        <p style="font-size: 18px; color: #333;">Aap ka Pro Plan active ho chuka hai.</p>
        <p style="color: #666;">Aap window close karke App restart kar sakti hain.</p>
      </div>
    `);
  } catch (error) {
    res.status(500).send("Database Update Failed");
  }
});

// 3. Cancel Route
router.get("/cancel", (req, res) => {
  res.send(`
    <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
      <h1 style="color: #ef4444;">❌ Payment Cancelled</h1>
      <p style="font-size: 18px; color: #333;">Payment complete nahi ho saki.</p>
    </div>
  `);
});

// 4. Direct Verify Route
router.post("/verify-payment", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Status fetch karke current user return karein
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
