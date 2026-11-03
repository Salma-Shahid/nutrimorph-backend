const checkAndAwardBadges = (user, exerciseData) => {
  if (!user.unlockedBadges) user.unlockedBadges = [];
  const earnedBadgeIds = user.unlockedBadges.map((badge) => {
    const badgeId =
      typeof badge === "string" ? badge : badge?.badgeId || badge?.id;
    return String(badgeId || "").replace(/^steps_/, "step_");
  });

  const steps = exerciseData?.steps || 0;
  const weightDiff = Math.abs(user.weightChange || 0);

  [
    { count: 5000, badgeId: "step_5k" },
    { count: 10000, badgeId: "step_10k" },
    { count: 15000, badgeId: "step_15k" },
    { count: 20000, badgeId: "step_20k" },
    { count: 25000, badgeId: "step_25k" },
    { count: 30000, badgeId: "step_30k" },
  ].forEach(({ count, badgeId }) => {
    if (steps >= count && !earnedBadgeIds.includes(badgeId)) {
      user.unlockedBadges.push({ badgeId, unlockedAt: new Date() });
    }
  });

  // 2. Weight Loss/Gain Badges Check (e.g., 1kg, 3kg, 5kg, 10kg)
  if (weightDiff >= 1 && !earnedBadgeIds.includes("weight_1kg")) {
    user.unlockedBadges.push({ badgeId: "weight_1kg", unlockedAt: new Date() });
  }
  if (weightDiff >= 5 && !earnedBadgeIds.includes("weight_5kg")) {
    user.unlockedBadges.push({ badgeId: "weight_5kg", unlockedAt: new Date() });
  }
  if (weightDiff >= 10 && !earnedBadgeIds.includes("weight_10kg")) {
    user.unlockedBadges.push({
      badgeId: "weight_10kg",
      unlockedAt: new Date(),
    });
  }
};

module.exports = { checkAndAwardBadges };
