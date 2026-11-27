const crypto = require("crypto");
const axios = require("axios");
const User = require("../models/User");

// RevenueCat is the primary in-app subscription provider. Entitlements are
// always verified server-side against the RevenueCat REST API using the
// secret key, never trusted from the client.
const REVENUECAT_API = "https://api.revenuecat.com/v1";
const REQUEST_TIMEOUT_MS = 10000;

const getEntitlementId = () =>
  (process.env.REVENUECAT_ENTITLEMENT_ID || "pro").trim();

const isRevenueCatConfigured = () =>
  Boolean(process.env.REVENUECAT_SECRET_API_KEY?.trim());

const isWebhookConfigured = () =>
  Boolean(process.env.REVENUECAT_WEBHOOK_AUTH?.trim());

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const verifyWebhookAuthorization = (header) => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH?.trim();
  if (!expected) return false;
  const received = String(header || "").trim();
  return (
    safeEqual(received, expected) || safeEqual(received, `Bearer ${expected}`)
  );
};

const fetchSubscriber = async (appUserId) => {
  const response = await axios.get(
    `${REVENUECAT_API}/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.REVENUECAT_SECRET_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  return response.data?.subscriber || null;
};

// Reduce a RevenueCat subscriber payload to the entitlement we care about.
const readEntitlement = (subscriber, now = Date.now()) => {
  const entitlement = subscriber?.entitlements?.[getEntitlementId()];
  if (!entitlement) return { active: false };

  const expiresRaw =
    entitlement.grace_period_expires_date || entitlement.expires_date;
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  const active = !expiresAt || expiresAt.getTime() > now;
  const productId = entitlement.product_identifier || null;
  const subscription = productId
    ? subscriber?.subscriptions?.[productId]
    : null;

  const purchasedRaw =
    subscription?.purchase_date || entitlement.purchase_date || null;
  const purchasedAt = purchasedRaw ? new Date(purchasedRaw) : null;

  return {
    active,
    expiresAt,
    productId,
    purchasedAt:
      purchasedAt && Number.isFinite(purchasedAt.getTime()) ? purchasedAt : null,
    isTrial: subscription?.period_type === "trial",
    willRenew: subscription ? !subscription.unsubscribe_detected_at : null,
    store: subscription?.store || null,
  };
};

// Persist the verified entitlement on the user. Access granted by another
// provider (admin grant, Paddle) is never revoked by an inactive RevenueCat
// state, so users are not downgraded by a store account they never used.
const applyEntitlementToUser = async (userId, entitlement) => {
  const user = await User.findById(userId);
  if (!user) return null;

  const update = { revenueCatLastSyncedAt: new Date() };
  if (entitlement.active) {
    Object.assign(update, {
      subscriptionTier: "pro",
      isPro: true,
      subscriptionStatus: entitlement.isTrial ? "trialing" : "active",
      subscriptionExpiresAt: entitlement.expiresAt,
      billingProvider: "revenuecat",
      revenueCatProductId: entitlement.productId,
    });
    if (entitlement.isTrial) {
      // Store free trial (e.g. 3 days). trialUsedAt records first use only.
      const trialStart = entitlement.purchasedAt || new Date();
      Object.assign(update, {
        trialStartDate: trialStart,
        trialEndDate: entitlement.expiresAt,
      });
      if (!user.trialUsedAt) update.trialUsedAt = trialStart;
    } else {
      // Paid period (trial converted or no trial). trialUsedAt is kept.
      Object.assign(update, { trialStartDate: null, trialEndDate: null });
    }
  } else if (user.billingProvider === "revenuecat") {
    Object.assign(update, {
      subscriptionTier: "free",
      isPro: false,
      subscriptionStatus: "expired",
    });
  }

  return User.findByIdAndUpdate(userId, { $set: update }, { new: true });
};

const syncUserFromRevenueCat = async (userId) => {
  const subscriber = await fetchSubscriber(String(userId));
  const entitlement = readEntitlement(subscriber);
  const user = await applyEntitlementToUser(userId, entitlement);
  return { user, entitlement };
};

module.exports = {
  getEntitlementId,
  isRevenueCatConfigured,
  isWebhookConfigured,
  verifyWebhookAuthorization,
  fetchSubscriber,
  readEntitlement,
  applyEntitlementToUser,
  syncUserFromRevenueCat,
};
