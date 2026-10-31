const checkAndAwardBadges = (user, exerciseData) => {
  if (!user.unlockedBadges) user.unlockedBadges = [];
  const earnedBadgeIds = user.unlockedBadges.map((b) => b.badgeId);

  const steps = exerciseData?.steps || 0;
  const weightDiff = Math.abs(user.weightChange || 0);

  // 1. Steps Badges Check
  if (steps >= 5000 && !earnedBadgeIds.includes("steps_5k")) {
    user.unlockedBadges.push({ badgeId: "steps_5k", unlockedAt: new Date() });
  }
  if (steps >= 10000 && !earnedBadgeIds.includes("steps_10k")) {
    user.unlockedBadges.push({ badgeId: "steps_10k", unlockedAt: new Date() });
  }

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
