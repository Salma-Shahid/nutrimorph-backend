const isProUser = (user) => {
  if (!user) return false;
  const now = Date.now();
  const subscriptionEnd = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt).getTime()
    : 0;
  const status = String(user.subscriptionStatus || "").toLowerCase();

  return (
    status === "active" &&
    user.subscriptionTier === "pro" &&
    user.isPro === true &&
    Number.isFinite(subscriptionEnd) &&
    subscriptionEnd > now
  );
};

module.exports = isProUser;
