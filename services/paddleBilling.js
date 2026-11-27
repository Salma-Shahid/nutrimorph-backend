const { Paddle, Environment } = require("@paddle/paddle-node-sdk");

const isProduction = () => process.env.NODE_ENV === "production";

const assertPaddleConfigured = () => {
  const missing = ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET"].filter(
    (key) => !process.env[key]?.trim(),
  );
  if (isProduction() && process.env.PADDLE_ENV !== "production") {
    missing.push("PADDLE_ENV=production");
  }
  if (missing.length) {
    throw new Error(`Paddle billing is not configured: ${missing.join(", ")}.`);
  }
};

const assertPaddlePricesConfigured = () => {
  const invalid = ["PADDLE_PRICE_ID_MONTHLY", "PADDLE_PRICE_ID_YEARLY"].filter(
    (key) => !/^pri_[A-Za-z0-9_]+$/.test(process.env[key] || ""),
  );
  if (invalid.length) {
    throw new Error(`Paddle prices are not configured: ${invalid.join(", ")}.`);
  }
};

const getPaddleClient = () => {
  assertPaddleConfigured();
  return new Paddle(process.env.PADDLE_API_KEY, {
    environment:
      process.env.PADDLE_ENV === "production"
        ? Environment.production
        : Environment.sandbox,
  });
};

const updateScheduledCancellation = async (subscriptionId, cancel) => {
  const paddle = getPaddleClient();
  const current = await paddle.subscriptions.get(subscriptionId);
  if (current.status !== "active") return current;
  return cancel
    ? paddle.subscriptions.cancel(subscriptionId, {
        effectiveFrom: "next_billing_period",
      })
    : current.scheduledChange?.action === "cancel"
      ? paddle.subscriptions.update(subscriptionId, { scheduledChange: null })
      : current;
};

const syncUserCancellation = async (user, cancel) => {
  if (!user.paddleSubscriptionId) return { scheduled: false };
  const subscription = await updateScheduledCancellation(
    user.paddleSubscriptionId,
    cancel,
  );
  if (!cancel) {
    return { scheduled: false, subscription };
  }
  return {
    scheduled: subscription.scheduledChange?.action === "cancel",
    currentPeriodEnd: subscription.currentBillingPeriod?.endsAt
      ? new Date(subscription.currentBillingPeriod.endsAt)
      : null,
  };
};

const isPaddleConfigured = () => {
  try {
    assertPaddleConfigured();
    return true;
  } catch {
    return false;
  }
};

// Never throws. Account deletion/restoration must not be blocked because
// Paddle is unconfigured, pending approval, or temporarily unreachable.
const safeSyncUserCancellation = async (user, cancel) => {
  if (!user?.paddleSubscriptionId) return { ok: true, skipped: true };
  if (!isPaddleConfigured()) {
    return {
      ok: false,
      warning:
        "Paddle billing is not configured, so the Paddle subscription could not be updated automatically.",
    };
  }
  try {
    const result = await syncUserCancellation(user, cancel);
    return { ok: true, ...result };
  } catch (error) {
    console.error("Paddle cancellation sync failed:", error.message);
    return {
      ok: false,
      warning: "The Paddle subscription could not be updated automatically.",
    };
  }
};

module.exports = {
  assertPaddleConfigured,
  assertPaddlePricesConfigured,
  getPaddleClient,
  isPaddleConfigured,
  syncUserCancellation,
  safeSyncUserCancellation,
};
