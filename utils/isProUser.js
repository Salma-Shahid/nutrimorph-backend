const isProUser = (user) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  const expired =
    user.subscriptionExpiresAt &&
    new Date(user.subscriptionExpiresAt).getTime() <= Date.now();
  return !expired && (user.subscriptionTier === "pro" || user.isPro === true);
};

module.exports = isProUser;
