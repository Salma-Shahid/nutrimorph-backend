const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const User = require("../models/User");
const { protect } = require("../middlewares/authMiddleware");
const { GEMINI_MODEL } = require("../config/ai");
const normalizeSubscription = require("../utils/normalizeSubscription");

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_dev";
const stripe = Stripe(stripeKey);

const syncStripeSubscription = async (subscription) => {
  const userId =
    subscription.metadata?.userId ||
    (
      await User.findOne({ stripeSubscriptionId: subscription.id }).select(
        "_id",
      )
    )?._id;
  if (!userId) return null;

  const active =
    ["active", "trialing"].includes(subscription.status) &&
    (!subscription.current_period_end ||
      subscription.current_period_end * 1000 > Date.now()) &&
    (subscription.status !== "trialing" ||
      (subscription.trial_end && subscription.trial_end * 1000 > Date.now()));

  return User.findByIdAndUpdate(
    userId,
    {
      subscriptionTier: active ? "pro" : "free",
      isPro: active,
      subscriptionStatus: subscription.status,
      subscriptionExpiresAt:
        active && subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
      trialEndDate: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      ...(subscription.trial_end ? { trialUsedAt: new Date() } : {}),
      ...(subscription.customer
        ? { stripeCustomerId: String(subscription.customer) }
        : {}),
      stripeSubscriptionId: String(subscription.id),
    },
    { new: true },
  );
};

const handleStripeWebhook = async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res
      .status(503)
      .json({ message: "Stripe webhook is not configured." });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    return res
      .status(400)
      .json({ message: `Invalid Stripe webhook: ${error.message}` });
  }

  try {
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncStripeSubscription(event.data.object);
    } else if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          String(session.subscription),
        );
        await syncStripeSubscription(subscription);
      }
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Could not synchronize Stripe subscription webhook:", error);
    return res
      .status(500)
      .json({ message: "Subscription synchronization failed." });
  }
};

// 1. Create Checkout Session for Pro Plan
router.post("/create-checkout-session", protect, async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({
        message: "Stripe API Key missing on server.",
      });
    }

    const { billingCycle, trialDays } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    await normalizeSubscription(user);
    if (user.subscriptionTier === "pro" && user.isPro) {
      return res.status(409).json({
        message: "Your Pro subscription is already active.",
      });
    }

    const startTrial = Number(trialDays) === 3;
    if (trialDays != null && !startTrial) {
      return res.status(400).json({ message: "Unsupported trial duration." });
    }
    if (startTrial && user.trialUsedAt) {
      return res.status(409).json({
        code: "TRIAL_ALREADY_USED",
        message: "The free trial has already been used for this account.",
      });
    }

    const isYearly = billingCycle === "yearly";
    const unitAmount = isYearly ? 9900 : 999; // $99/yr or $9.99/mo
    const interval = isYearly ? "year" : "month";

    const serverUrl = (
      process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`
    ).replace(/\/$/, "");

    // Strictly ensure only ONE parameter is passed to Stripe
    const checkoutPayload = {
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
        trialDays: startTrial ? "3" : "0",
        brand: "NutriMorph App",
      },
      subscription_data: {
        ...(startTrial ? { trial_period_days: 3 } : {}),
        metadata: {
          userId: String(req.user._id),
          trialDays: startTrial ? "3" : "0",
          brand: "NutriMorph App",
        },
      },
      success_url: `${serverUrl}/api/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${serverUrl}/api/payment/cancel`,
    };

    // Strict single condition check
    if (user.stripeCustomerId && user.stripeCustomerId.trim() !== "") {
      checkoutPayload.customer = user.stripeCustomerId;
    } else if (user.email) {
      checkoutPayload.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(checkoutPayload);

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
    const userId = session.client_reference_id || session.metadata?.userId;
    const subscriptionStatus = session.subscription?.status;
    if (
      session.mode !== "subscription" ||
      !["paid", "no_payment_required"].includes(session.payment_status) ||
      !userId ||
      !["active", "trialing"].includes(subscriptionStatus)
    ) {
      return res.redirect(
        `${(process.env.FRONTEND_URL || process.env.CLIENT_URL || "https://nutrimorph.app").replace(/\/$/, "")}/?payment=failed`,
      );
    }
    const subscription = session.subscription;
    const user = await User.findByIdAndUpdate(
      userId,
      {
        subscriptionTier: "pro",
        isPro: true,
        subscriptionStatus,
        subscriptionExpiresAt: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null,
        trialStartDate: subscription.trial_start
          ? new Date(subscription.trial_start * 1000)
          : undefined,
        trialEndDate: subscription.trial_end
          ? new Date(subscription.trial_end * 1000)
          : null,
        ...(subscription.customer
          ? { stripeCustomerId: String(subscription.customer) }
          : {}),
        stripeSubscriptionId: String(subscription.id),
        ...(session.metadata?.trialDays === "3"
          ? { trialUsedAt: new Date() }
          : {}),
      },
      { new: true },
    );
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
    let user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      const subscription = await stripe.subscriptions.retrieve(
        user.stripeSubscriptionId,
      );
      user =
        (await syncStripeSubscription(subscription)) ||
        (await User.findById(req.user._id));
    }
    await normalizeSubscription(user);
    user.password = undefined;
    return res.json({
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
    user.subscriptionStatus = "free";
    user.subscriptionExpiresAt = null;
    user.trialEndDate = null;

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
    user.subscriptionStatus = "free";
    user.subscriptionExpiresAt = null;
    user.trialEndDate = null;
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

router.handleStripeWebhook = handleStripeWebhook;
module.exports = router;
