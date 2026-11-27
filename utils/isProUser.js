// Single source of truth for subscription state.
//
// Every endpoint that reports or enforces Pro access must go through this
// module so `isPro`, `subscriptionTier`, and `subscriptionStatus` can never
// disagree with each other (e.g. a user stored as tier "pro" being shown FREE).

// Statuses that grant access while the period has not expired.
const ACTIVE_STATUSES = new Set(["active", "trialing"]);
// Statuses that always revoke access regardless of the stored tier.
const INACTIVE_STATUSES = new Set([
  "canceled",
  "cancelled",
  "past_due",
  "paused",
  "expired",
  "revoked",
]);

const toTime = (value) => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

const isProUser = (user, now = Date.now()) => {
  if (!user || user.subscriptionTier !== "pro") return false;

  const status = String(user.subscriptionStatus || "").toLowerCase();
  if (INACTIVE_STATUSES.has(status)) return false;

  // Legacy records were granted Pro by setting tier/isPro directly while the
  // status stayed at its "free" default. Honour them only when isPro agrees.
  if (!ACTIVE_STATUSES.has(status) && user.isPro !== true) return false;

  // A missing expiry means an open-ended grant (admin lifetime, RevenueCat
  // lifetime product). A present expiry must still be in the future.
  const expiresAt = toTime(user.subscriptionExpiresAt);
  return expiresAt === null || expiresAt > now;
};

// Normalised, client-safe view of a user's plan. `plan` is what UIs display.
const getSubscriptionSnapshot = (user, now = Date.now()) => {
  const isPro = isProUser(user, now);
  const rawStatus = String(user?.subscriptionStatus || "").toLowerCase();
  const expiresAt = toTime(user?.subscriptionExpiresAt);

  let subscriptionStatus;
  if (isPro) {
    subscriptionStatus = rawStatus === "trialing" ? "trialing" : "active";
  } else if (user?.subscriptionTier === "pro" && expiresAt && expiresAt <= now) {
    subscriptionStatus = "expired";
  } else if (INACTIVE_STATUSES.has(rawStatus)) {
    subscriptionStatus = rawStatus;
  } else {
    subscriptionStatus = "free";
  }

  return {
    isPro,
    subscriptionTier: isPro ? "pro" : "free",
    subscriptionStatus,
    plan: isPro ? (subscriptionStatus === "trialing" ? "trial" : "pro") : "free",
    subscriptionExpiresAt: user?.subscriptionExpiresAt || null,
    billingProvider: user?.billingProvider || null,
    trialEndDate: user?.trialEndDate || null,
  };
};

// Mongo filter matching the same rule, for counts and broadcast targeting.
const activeProFilter = (now = new Date()) => ({
  subscriptionTier: "pro",
  subscriptionStatus: { $nin: [...INACTIVE_STATUSES] },
  $and: [
    {
      $or: [
        { subscriptionStatus: { $in: [...ACTIVE_STATUSES] } },
        { isPro: true },
      ],
    },
    {
      $or: [
        { subscriptionExpiresAt: null },
        { subscriptionExpiresAt: { $exists: false } },
        { subscriptionExpiresAt: { $gt: now } },
      ],
    },
  ],
});

module.exports = isProUser;
module.exports.isProUser = isProUser;
module.exports.getSubscriptionSnapshot = getSubscriptionSnapshot;
module.exports.activeProFilter = activeProFilter;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
