const User = require("../models/User");
const GemTransaction = require("../models/GemTransaction");
const isProUser = require("../utils/isProUser");

// ---- Configuration ---------------------------------------------------------
// Gems needed to revive a broken streak.
const REVIVE_COST = 2;
// Gems granted per rewarded ad (free users, only while a streak is revivable).
const AD_REWARD_GEMS = 2;
const MAX_AD_REWARDS_PER_DAY = 2;
// A streak can be revived if at most this many days were missed.
const MAX_MISSED_DAYS = 3;
// Streaks shorter than this aren't worth reviving.
const MIN_REVIVABLE_STREAK = 2;

// Pro tiers, ascending, by the user's best-ever streak (days).
const PRO_TIERS = [
  { id: "emerald", name: "Emerald", minBestStreak: 0, monthlyGems: 4 },
  { id: "gold", name: "Gold", minBestStreak: 30, monthlyGems: 6 },
  { id: "sapphire", name: "Sapphire", minBestStreak: 90, monthlyGems: 10 },
  { id: "ruby", name: "Ruby", minBestStreak: 180, monthlyGems: 15 },
];

// ---- Helpers ---------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (value) => {
  if (!DATE_RE.test(String(value || ""))) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) ? Math.round(time / 86400000) : null;
};
const fromDayNumber = (day) =>
  new Date(day * 86400000).toISOString().slice(0, 10);

// The client sends its local date (same as meal/step logging). Accept it only
// within a day of the server's UTC date to block date spoofing.
const resolveClientDate = (raw) => {
  const serverDay = Math.floor(Date.now() / 86400000);
  const day = dayNumber(raw);
  if (day === null || Math.abs(day - serverDay) > 1) return fromDayNumber(serverDay);
  return raw;
};

const currentMonthKey = () => new Date().toISOString().slice(0, 7);

const getTier = (user) => {
  const best = Math.max(Number(user?.bestStreak) || 0, Number(user?.streakCount) || 0);
  let tier = PRO_TIERS[0];
  for (const candidate of PRO_TIERS) {
    if (best >= candidate.minBestStreak) tier = candidate;
  }
  const next = PRO_TIERS[PRO_TIERS.indexOf(tier) + 1] || null;
  return {
    ...tier,
    bestStreak: best,
    next: next
      ? {
          id: next.id,
          name: next.name,
          minBestStreak: next.minBestStreak,
          daysToGo: next.minBestStreak - best,
          monthlyGems: next.monthlyGems,
        }
      : null,
  };
};

// Broken-streak state for `today` (YYYY-MM-DD).
//  - "pending": days were missed and nothing logged yet today; streakCount
//    still holds the old value.
//  - "reset": the user already logged today, which reset the streak to 1;
//    the old value was snapshotted in lostStreak by the User model.
const getStreakState = (user, today) => {
  const todayDay = dayNumber(today);
  const streakCount = Number(user?.streakCount) || 0;
  const base = {
    count: streakCount,
    best: Math.max(Number(user?.bestStreak) || 0, streakCount),
    broken: false,
    revivable: false,
    lostStreak: 0,
    missedDays: 0,
    mode: null,
    reviveCost: REVIVE_COST,
  };

  const lostOn = dayNumber(user?.lostStreakOn);
  if (user?.lostStreak >= MIN_REVIVABLE_STREAK && lostOn !== null && todayDay !== null) {
    const daysSinceReset = todayDay - lostOn;
    // Revivable while the post-reset streak is still unbroken.
    const stillContinuous =
      dayNumber(user.lastLoggedDate) !== null &&
      todayDay - dayNumber(user.lastLoggedDate) <= 1;
    if (daysSinceReset >= 0 && daysSinceReset <= MAX_MISSED_DAYS && stillContinuous) {
      const missed = Number(user.lostStreakMissedDays) || 1;
      return {
        ...base,
        broken: true,
        revivable: missed <= MAX_MISSED_DAYS,
        lostStreak: Number(user.lostStreak),
        missedDays: missed,
        mode: "reset",
      };
    }
  }

  const lastDay = dayNumber(user?.lastLoggedDate);
  if (lastDay !== null && todayDay !== null && streakCount >= 1) {
    const missed = todayDay - lastDay - 1;
    if (missed >= 1) {
      return {
        ...base,
        // The displayed streak is effectively 0 until revived or restarted.
        count: 0,
        broken: true,
        revivable: streakCount >= MIN_REVIVABLE_STREAK && missed <= MAX_MISSED_DAYS,
        lostStreak: streakCount,
        missedDays: missed,
        mode: "pending",
      };
    }
  }
  return base;
};

const logTransaction = (userId, type, amount, balanceAfter, meta = {}) =>
  GemTransaction.create({ userId, type, amount, balanceAfter, meta }).catch((error) =>
    console.error("Could not record gem transaction:", error.message),
  );

// Grants this month's Pro gems once (atomic: concurrent calls can't double-grant).
const applyMonthlyGrant = async (user) => {
  if (!isProUser(user) || user.deactivatedAt) return { user, granted: null };
  const month = currentMonthKey();
  if (user.gemsLastGrantMonth === month) return { user, granted: null };

  const tier = getTier(user);
  const updated = await User.findOneAndUpdate(
    { _id: user._id, gemsLastGrantMonth: { $ne: month } },
    {
      $inc: { gems: tier.monthlyGems },
      $set: { gemsLastGrantMonth: month, gemsLastGrantTier: tier.id },
    },
    { new: true },
  );
  if (!updated) {
    // Another request granted it first.
    return { user: (await User.findById(user._id)) || user, granted: null };
  }
  await logTransaction(user._id, "monthly_grant", tier.monthlyGems, updated.gems, {
    month,
    tier: tier.id,
  });
  return { user: updated, granted: { amount: tier.monthlyGems, tier: tier.name, month } };
};

const buildStatus = (user, today, extra = {}) => {
  const isPro = isProUser(user);
  const streak = getStreakState(user, today);
  const adCount = user.adRewardDate === today ? Number(user.adRewardCount) || 0 : 0;
  const adRewardsLeft = Math.max(0, MAX_AD_REWARDS_PER_DAY - adCount);
  const gems = Number(user.gems) || 0;
  const tier = isPro ? getTier(user) : null;
  return {
    gems,
    isPro,
    date: today,
    tier,
    tiers: PRO_TIERS.map(({ id, name, minBestStreak, monthlyGems }) => ({
      id,
      name,
      minBestStreak,
      monthlyGems,
    })),
    monthlyGrant: isPro
      ? {
          month: currentMonthKey(),
          grantedThisMonth: user.gemsLastGrantMonth === currentMonthKey(),
          amount: tier.monthlyGems,
        }
      : null,
    streak: { ...streak, canAfford: gems >= REVIVE_COST },
    ad: {
      rewardGems: AD_REWARD_GEMS,
      rewardsLeftToday: adRewardsLeft,
      // Ads are for free users who need gems to revive a broken streak.
      eligible: !isPro && streak.revivable && gems < REVIVE_COST && adRewardsLeft > 0,
    },
    ...extra,
  };
};

module.exports = {
  REVIVE_COST,
  AD_REWARD_GEMS,
  MAX_AD_REWARDS_PER_DAY,
  PRO_TIERS,
  dayNumber,
  fromDayNumber,
  resolveClientDate,
  getTier,
  getStreakState,
  applyMonthlyGrant,
  buildStatus,
  logTransaction,
};
