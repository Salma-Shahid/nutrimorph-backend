const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const User = require("../models/User");
const { protect } = require("../middlewares/authMiddleware");
const { GEMINI_MODEL } = require("../config/ai");

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_dev";
const stripe = Stripe(stripeKey);

// 1. Create Checkout Session for Pro Plan
router.post("/create-checkout-session", protect, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({
        message: "Stripe API Key missing on server.",
      });
    }

    const { plan, billingCycle } = req.body;

    const isYearly = billingCycle === "yearly";
    const unitAmount = isYearly ? 9900 : 999; // $99/yr or $9.99/mo
    const interval = isYearly ? "year" : "month";

    const appUrl = (
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "https://nutrimorph.app"
    ).replace(/\/$/, "");
    const serverUrl = (
      process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `NutriMorph App Pro (${isYearly ? "Yearly" : "Monthly"})`,
              description: "Unlimited AI Chat, Camera Scanner & Analytics",
              metadata: { brand: "NutriMorph App" },
            },
            unit_amount: unitAmount,
            recurring: { interval: interval },
          },
          quantity: 1,
        },
      ],
      client_reference_id: String(req.user._id),
      metadata: {
        userId: String(req.user._id),
        billingCycle: isYearly ? "yearly" : "monthly",
        brand: "NutriMorph App",
      },
      subscription_data: {
        metadata: { userId: String(req.user._id), brand: "NutriMorph App" },
      },
      success_url: `${serverUrl}/api/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${serverUrl}/api/payment/cancel`,
    });

    res.json({ success: true, url: session.url, id: session.id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 2. Success Redirect (MongoDB Auto Update & Redirect to Web App)
router.get("/success", async (req, res) => {
  try {
    const { session_id: sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).send("Checkout session is missing.");
    }
    const session = await stripe.checkout.sessions.retrieve(String(sessionId), {
      expand: ["subscription"],
    });
    const userId =
      session.client_reference_id || session.metadata?.userId;
    const subscriptionStatus = session.subscription?.status;
    if (
      session.mode !== "subscription" ||
      session.payment_status !== "paid" ||
      !userId ||
      !["active", "trialing"].includes(subscriptionStatus)
    ) {
      return res.redirect(
        `${(process.env.FRONTEND_URL || process.env.CLIENT_URL || "https://nutrimorph.app").replace(/\/$/, "")}/?payment=failed`,
      );
    }
    const user = await User.findByIdAndUpdate(userId, {
      subscriptionTier: "pro",
      isPro: true,
      subscriptionExpiresAt: new Date(
        session.subscription.current_period_end * 1000,
      ),
    });
    if (!user) return res.status(404).send("Account not found.");
    const appUrl = (
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "https://nutrimorph.app"
    ).replace(/\/$/, "");
    res.redirect(`${appUrl}/?payment=success`);
  } catch (error) {
    res.status(500).send("Database Update Failed");
  }
});

// 3. Cancel Route
router.get("/cancel", (req, res) => {
  const appUrl = (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    "https://nutrimorph.app"
  ).replace(/\/$/, "");
  res.redirect(`${appUrl}/?payment=cancelled`);
});

// 4. Direct Verify Route
router.post("/verify-payment", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "_id name email subscriptionTier isPro subscriptionExpiresAt",
    );
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// 5. Update / Switch Plan Route
router.post("/update-plan", protect, async (req, res) => {
  try {
    const { plan } = req.body;

    if (plan && plan.toLowerCase() === "pro") {
      return res.status(400).json({
        success: false,
        message:
          "Pro plan activation requires payment. Please use the checkout session.",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found." });
    }

    user.subscriptionTier = "free";
    user.isPro = false;
    user.subscriptionExpiresAt = null;

    await user.save();

    res.json({
      success: true,
      message: "Subscription successfully updated to Free Plan!",
      user,
      aiModel: GEMINI_MODEL,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. Downgrade / Switch to Free Plan
router.post("/switch-to-free", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.subscriptionTier = "free";
    user.isPro = false;
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
