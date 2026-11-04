const isProUser = (user) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  const now = Date.now();
  const trialEnd = user.trialEndDate
    ? new Date(user.trialEndDate).getTime()
    : 0;
  const subscriptionEnd = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt).getTime()
    : 0;
  const status = String(user.subscriptionStatus || "").toLowerCase();

  if (
    ["canceled", "cancelled", "unpaid", "incomplete_expired", "expired"].includes(
      status,
    )
  ) {
    return false;
  }
  if (status === "trialing") return trialEnd > now;

  const entitled =
    user.subscriptionTier === "pro" || user.isPro === true || trialEnd > now;
  return entitled && (!subscriptionEnd || subscriptionEnd > now);
};

module.exports = isProUser;
