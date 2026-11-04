const isProUser = require("./isProUser");

const normalizeSubscription = async (user) => {
  if (!user || user.role === "admin") return user;

  const status = String(user.subscriptionStatus || "").toLowerCase();
  const expiredStatus = [
    "canceled",
    "cancelled",
    "unpaid",
    "incomplete_expired",
    "expired",
  ].includes(status);
  const expiredTrial =
    status === "trialing" &&
    (!user.trialEndDate || new Date(user.trialEndDate).getTime() <= Date.now());
  const expiredSubscription =
    user.subscriptionExpiresAt &&
    new Date(user.subscriptionExpiresAt).getTime() <= Date.now();

  if (
    (expiredStatus || expiredTrial || expiredSubscription) &&
    (user.subscriptionTier === "pro" || user.isPro)
  ) {
    user.subscriptionTier = "free";
    user.isPro = false;
    user.subscriptionStatus = expiredTrial ? "expired" : status || "expired";
    user.subscriptionExpiresAt = null;
    await user.save();
    return user;
  }

  if (user.subscriptionTier === "free" && user.isPro) {
    user.isPro = false;
    await user.save();
  }
  return user;
};

module.exports = normalizeSubscription;
