const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const PaddleCheckoutIntent = require("../models/PaddleCheckoutIntent");
const PaddlePayout = require("../models/PaddlePayout");
const PaddleTransaction = require("../models/PaddleTransaction");
const ProcessedPaddleEvent = require("../models/ProcessedPaddleEvent");
const { protect } = require("../middlewares/authMiddleware");
const { GEMINI_MODEL } = require("../config/ai");
const isProUser = require("../utils/isProUser");
const connectDB = require("../config/db");
const {
  assertPaddleConfigured,
  assertPaddlePricesConfigured,
  getPaddleClient,
  syncUserCancellation,
} = require("../services/paddleBilling");

let billingIndexesPromise;
const ensureBillingIndexes = () => {
  if (!billingIndexesPromise) {
    billingIndexesPromise = Promise.all([
      ProcessedPaddleEvent.createIndexes(),
      PaddleCheckoutIntent.createIndexes(),
      PaddleTransaction.createIndexes(),
      PaddlePayout.createIndexes(),
    ]).catch((error) => {
      billingIndexesPromise = null;
      throw error;
    });
  }
  return billingIndexesPromise;
};

const getPriceId = (billingCycle) =>
  process.env[
    billingCycle === "yearly"
      ? "PADDLE_PRICE_ID_YEARLY"
      : "PADDLE_PRICE_ID_MONTHLY"
  ];

const getItemPriceIds = (items = []) =>
  items.map((item) => item?.price?.id).filter(Boolean);

const getCustomIntentId = (entity) => {
  const value = entity?.customData?.checkoutIntentId;
  return typeof value === "string" ? value : null;
};

const getIntentAndUser = async (entity, subscriptionId) => {
  const intentId = getCustomIntentId(entity);
  if (intentId) {
    const intent = await PaddleCheckoutIntent.findOne({ intentId });
    if (intent) {
      const user = await User.findById(intent.userId);
      if (user) return { intent, user };
    }
  }
  if (subscriptionId) {
    const user = await User.findOne({
      paddleSubscriptionId: String(subscriptionId),
    });
    if (user) return { intent: null, user };
  }
  return { intent: null, user: null };
};

const updateSubscriptionState = async (
  subscription,
  event,
  { forceRevoke = false, statusOverride } = {},
) => {
  const { intent, user } = await getIntentAndUser(
    subscription,
    subscription.id,
  );
  if (!user) return;
  if (
    user.paddleSubscriptionId &&
    user.paddleSubscriptionId !== subscription.id &&
    isProUser(user)
  ) {
    return;
  }

  const priceIds = getItemPriceIds(subscription.items);
  const expectedPriceId = intent?.priceId || user.paddlePriceId;
  if (!expectedPriceId || !priceIds.includes(expectedPriceId)) return;

  const paddle = getPaddleClient();
  const customer = await paddle.customers.get(subscription.customerId);
  if (String(customer.email || "").toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("Paddle subscription customer does not match the account.");
  }

  const eventAt = new Date(event.occurredAt);
  const periodEnd = subscription.currentBillingPeriod?.endsAt
    ? new Date(subscription.currentBillingPeriod.endsAt)
    : null;
  const status = statusOverride || subscription.status;
  const stillPaidThroughPeriod =
    status === "active" && periodEnd && periodEnd.getTime() > Date.now();
  const shouldRevoke =
    forceRevoke ||
    status === "canceled" ||
    status === "past_due" ||
    status === "paused" ||
    !stillPaidThroughPeriod;

  const update = {
    paddleCustomerId: subscription.customerId,
    paddleSubscriptionId: subscription.id,
    paddlePriceId: expectedPriceId,
    subscriptionStatus: status,
    subscriptionExpiresAt: periodEnd,
    trialStartDate: null,
    trialEndDate: null,
  };
  if (shouldRevoke) {
    update.subscriptionTier = "free";
    update.isPro = false;
  }

  const orderingFilter = Number.isFinite(eventAt.getTime())
    ? {
        _id: user._id,
        $or: [
          { paddleLastEventAt: { $exists: false } },
          { paddleLastEventAt: null },
          { paddleLastEventAt: { $lte: eventAt } },
        ],
      }
    : { _id: user._id };
  await User.findOneAndUpdate(
    orderingFilter,
    {
      $set: update,
      ...(Number.isFinite(eventAt.getTime())
        ? { $max: { paddleLastEventAt: eventAt } }
        : {}),
    },
    { new: true, runValidators: true },
  );

  if (intent && !intent.subscriptionId) {
    await PaddleCheckoutIntent.updateOne(
      { _id: intent._id, subscriptionId: null },
      { $set: { subscriptionId: subscription.id } },
    );
  }
};

const verifyTransactionAndGrant = async (transaction, paddle, event) => {
  if (transaction.status !== "completed" || !transaction.subscriptionId) return;

  const intentId = getCustomIntentId(transaction);
  let intent = intentId
    ? await PaddleCheckoutIntent.findOne({ intentId })
    : null;
  if (
    intent?.transactionId &&
    intent.transactionId !== String(transaction.id)
  ) {
    intent = null;
  }
  let user = intent ? await User.findById(intent.userId) : null;
  const itemPriceIds = getItemPriceIds(transaction.items);

  if (intent && user) {
    if (
      (!intent.transactionId && intent.expiresAt.getTime() < Date.now()) ||
      !itemPriceIds.includes(intent.priceId) ||
      itemPriceIds.length !== 1 ||
      transaction.items[0]?.quantity !== 1
    ) {
      throw new Error("Completed Paddle transaction does not match its checkout intent.");
    }
  } else {
    intent = null;
    user = await User.findOne({
      paddleSubscriptionId: String(transaction.subscriptionId),
    });
    if (
      !user ||
      !user.paddlePriceId ||
      !itemPriceIds.includes(user.paddlePriceId)
    ) {
      return;
    }
  }

  if (!user || user.deactivatedAt) return;
  const customer = transaction.customerId
    ? await paddle.customers.get(transaction.customerId)
    : null;
  if (
    !customer ||
    String(customer.email || "").toLowerCase() !== user.email.toLowerCase() ||
    (intent && intent.email !== user.email.toLowerCase())
  ) {
    throw new Error("Paddle transaction customer does not match the account.");
  }

  const subscription = await paddle.subscriptions.get(
    String(transaction.subscriptionId),
  );
  if (
    subscription.status !== "active" ||
    subscription.customerId !== transaction.customerId ||
    !getItemPriceIds(subscription.items).includes(
      intent?.priceId || user.paddlePriceId || itemPriceIds[0],
    )
  ) {
    return;
  }

  const amount = Number(transaction.details?.totals?.total);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Paddle completed transaction has no positive paid total.");
  }

  const transactionId = String(transaction.id);
  const eventAt = new Date(event.occurredAt);
  const periodEnd = transaction.billingPeriod?.endsAt
    ? new Date(transaction.billingPeriod.endsAt)
    : subscription.currentBillingPeriod?.endsAt
      ? new Date(subscription.currentBillingPeriod.endsAt)
      : null;

  if (intent) {
    const claimedIntent = await PaddleCheckoutIntent.findOneAndUpdate(
      {
        _id: intent._id,
        $or: [
          { transactionId: null },
          { transactionId },
        ],
        ...(intent.transactionId ? {} : { expiresAt: { $gte: new Date() } }),
      },
      {
        $set: {
          transactionId,
          subscriptionId: String(transaction.subscriptionId),
          completedAt: new Date(),
        },
      },
      { new: true },
    );
    if (!claimedIntent) {
      throw new Error("Checkout intent has already been used by another transaction.");
    }
  }

  await PaddleTransaction.updateOne(
    { transactionId },
    {
      $setOnInsert: {
        transactionId,
        userId: user._id,
        subscriptionId: String(transaction.subscriptionId),
        amount,
        currency: String(transaction.currencyCode || "usd").toLowerCase(),
        paidAt: new Date(transaction.billedAt || event.occurredAt),
      },
    },
    { upsert: true },
  );

  const expectedPriceId = intent?.priceId || user.paddlePriceId;
  const update = {
    subscriptionTier: "pro",
    isPro: true,
    subscriptionStatus: "active",
    subscriptionExpiresAt: periodEnd,
    paddleCustomerId: transaction.customerId,
    paddleSubscriptionId: String(transaction.subscriptionId),
    paddlePriceId: expectedPriceId,
    trialStartDate: null,
    trialEndDate: null,
  };
  await User.findOneAndUpdate(
    { _id: user._id },
    {
      $set: update,
      ...(Number.isFinite(eventAt.getTime())
        ? { $max: { paddleLastEventAt: eventAt } }
        : {}),
    },
    { new: true, runValidators: true },
  );
};

const processPaddleEvent = async (event, paddle) => {
  const data = event.data;
  if (["payout.created", "payout.paid"].includes(event.eventType)) {
    const eventAt = new Date(event.occurredAt);
    const payoutFields = {
      status: data.status || (event.eventType === "payout.paid" ? "paid" : "unpaid"),
      remittanceReference: data.remittanceReference || null,
      amount: Number(data.amount),
      currencyCode: String(data.currencyCode || "usd").toLowerCase(),
      lastEventAt: eventAt,
    };
    if (!Number.isFinite(payoutFields.amount)) {
      throw new Error("Paddle payout event has an invalid amount.");
    }
    try {
      await PaddlePayout.updateOne(
        {
          paddlePayoutId: String(data.id),
          $or: [
            { lastEventAt: { $exists: false } },
            { lastEventAt: { $lte: eventAt } },
          ],
        },
        {
          $set: payoutFields,
          $setOnInsert: { paddlePayoutId: String(data.id) },
        },
        { upsert: true },
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return;
  }

  if (event.eventType === "transaction.completed") {
    await verifyTransactionAndGrant(data, paddle, event);
    return;
  }

  if (event.eventType.startsWith("subscription.")) {
    await updateSubscriptionState(data, event, {
      forceRevoke: ["subscription.canceled", "subscription.paused"].includes(
        event.eventType,
      ),
    });
    return;
  }

  if (
    ["transaction.payment_failed", "transaction.past_due"].includes(
      event.eventType,
    ) &&
    data.subscriptionId
  ) {
    const subscription = await paddle.subscriptions.get(data.subscriptionId);
    await updateSubscriptionState(subscription, event, {
      forceRevoke: true,
      statusOverride: "past_due",
    });
  }
};

const handlePaddleWebhook = async (req, res) => {
  let event;
  let paddle;
  try {
    assertPaddleConfigured();
    paddle = getPaddleClient();
    const signature = req.headers["paddle-signature"];
    if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ message: "Invalid Paddle webhook request." });
    }
    event = await paddle.webhooks.unmarshal(
      req.body.toString("utf8"),
      process.env.PADDLE_WEBHOOK_SECRET,
      signature,
    );
  } catch (error) {
    const configured = /not configured|PADDLE_ENV/i.test(error.message || "");
    return res.status(configured ? 503 : 400).json({ message: error.message });
  }

  if (!event.eventId || !event.eventType || !event.data) {
    return res.status(400).json({ message: "Invalid Paddle event payload." });
  }

  try {
    await connectDB();
    await ensureBillingIndexes();
    await ProcessedPaddleEvent.create({ eventId: event.eventId });
  } catch (error) {
    if (error.code !== 11000) {
      console.error("Could not claim Paddle webhook event:", error);
      return res.status(500).json({ message: "Webhook event could not be recorded." });
    }

    let existing;
    let reclaimed;
    try {
      reclaimed = await ProcessedPaddleEvent.findOneAndUpdate(
        {
          eventId: event.eventId,
          processedAt: { $exists: false },
          updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) },
        },
        { $set: { updatedAt: new Date() } },
        { new: true },
      ).select("eventId");
      existing = await ProcessedPaddleEvent.findOne({
        eventId: event.eventId,
      }).select("processedAt");
    } catch (lookupError) {
      console.error("Could not inspect Paddle webhook state:", lookupError);
      return res.status(500).json({ message: "Webhook event state could not be checked." });
    }
    if (existing?.processedAt) {
      return res.status(200).json({ received: true, duplicate: true });
    }
    if (!reclaimed) {
      return res.status(409).json({ message: "Webhook event is being processed." });
    }
  }

  try {
    await processPaddleEvent(event, paddle);
    await ProcessedPaddleEvent.updateOne(
      { eventId: event.eventId },
      { $set: { processedAt: new Date() } },
    );
    return res.status(200).json({ received: true });
  } catch (error) {
    await ProcessedPaddleEvent.deleteOne({
      eventId: event.eventId,
      processedAt: { $exists: false },
    });
    console.error("Could not synchronize Paddle webhook:", error);
    return res.status(500).json({ message: "Paddle event synchronization failed." });
  }
};

router.post("/create-checkout-intent", protect, async (req, res) => {
  try {
    assertPaddleConfigured();
    assertPaddlePricesConfigured();
    await connectDB();
    await ensureBillingIndexes();
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    if (user.deactivatedAt) {
      return res.status(403).json({ message: "Reactivate your account to subscribe." });
    }
    if (isProUser(user)) {
      return res.status(409).json({ message: "Your Pro subscription is already active." });
    }

    const billingCycle = req.body?.billingCycle;
    if (!["monthly", "yearly"].includes(billingCycle)) {
      return res.status(400).json({ message: "Choose a valid billing cycle." });
    }
    const priceId = getPriceId(billingCycle);
    if (!priceId || !/^pri_[A-Za-z0-9_]+$/.test(priceId)) {
      throw new Error(`A valid PADDLE_PRICE_ID_${billingCycle.toUpperCase()} is required.`);
    }

    const intentId = crypto.randomUUID();
    const intent = await PaddleCheckoutIntent.create({
      intentId,
      userId: user._id,
      email: user.email.toLowerCase(),
      billingCycle,
      priceId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return res.status(201).json({
      success: true,
      intentId: intent.intentId,
      email: intent.email,
      priceId: intent.priceId,
      billingCycle: intent.billingCycle,
      expiresAt: intent.expiresAt,
    });
  } catch (error) {
    const status =
      /not configured|required|PADDLE_ENV/i.test(error.message) ? 503 : 500;
    return res.status(status).json({ message: error.message });
  }
});

router.post("/verify-payment", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "subscriptionTier isPro subscriptionExpiresAt subscriptionStatus",
    );
    if (!user) return res.status(404).json({ message: "User not found." });
    return res.json({
      success: true,
      user: {
        subscriptionTier: isProUser(user) ? "pro" : "free",
        isPro: isProUser(user),
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post("/cancel-subscription", protect, async (req, res) => {
  try {
    assertPaddleConfigured();
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });
    const cancellation = await syncUserCancellation(user, true);
    return res.json({
      success: true,
      message: cancellation.scheduled
        ? "Cancellation is scheduled for the end of the billing period."
        : "No active Paddle subscription was found.",
      currentPeriodEnd: cancellation.currentPeriodEnd,
      aiModel: GEMINI_MODEL,
    });
  } catch (error) {
    return res.status(503).json({ success: false, message: error.message });
  }
});

router.post("/webhook", express.raw({ type: "application/json" }), handlePaddleWebhook);

router.handlePaddleWebhook = handlePaddleWebhook;
router.syncUserCancellation = syncUserCancellation;
module.exports = router;
