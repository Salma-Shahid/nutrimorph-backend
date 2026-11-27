const User = require("../models/User");
const isProUser = require("../utils/isProUser");
const gems = require("../services/gems");

const loadUser = (req) => User.findById(req.user._id);

// @desc  Gem balance, Pro tier, monthly grant, streak + revive state.
//        Pro users receive this month's tier gems on the first call.
// @route GET /api/gems?date=YYYY-MM-DD
const getGemStatus = async (req, res) => {
  try {
    const today = gems.resolveClientDate(req.query?.date);
    let user = await loadUser(req);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const { user: granted, granted: monthlyGrant } = await gems.applyMonthlyGrant(user);
    user = granted;
    return res.status(200).json({
      success: true,
      data: gems.buildStatus(user, today, { justGranted: monthlyGrant }),
    });
  } catch (error) {
    console.error("Gem status failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not load your gems." });
  }
};

// @desc  Free users: claim gems after watching a rewarded ad. Only allowed
//        while a streak is revivable and gems are short, capped per day.
// @route POST /api/gems/ad-reward  { date }
const claimAdReward = async (req, res) => {
  try {
    const today = gems.resolveClientDate(req.body?.date);
    const user = await loadUser(req);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (isProUser(user)) {
      return res.status(400).json({
        success: false,
        code: "PRO_NO_ADS",
        message: "Pro members get monthly gems instead of ad rewards.",
      });
    }
    const status = gems.buildStatus(user, today);
    if (!status.streak.revivable) {
      return res.status(400).json({
        success: false,
        code: "NOTHING_TO_REVIVE",
        message: "Ad gems are available when you have a broken streak to revive.",
        data: status,
      });
    }
    if ((Number(user.gems) || 0) >= gems.REVIVE_COST) {
      return res.status(400).json({
        success: false,
        code: "ENOUGH_GEMS",
        message: "You already have enough gems to revive your streak.",
        data: status,
      });
    }

    // Atomic per-day cap: first claim of the day resets the counter.
    let updated = await User.findOneAndUpdate(
      { _id: user._id, adRewardDate: { $ne: today } },
      { $set: { adRewardDate: today, adRewardCount: 1 }, $inc: { gems: gems.AD_REWARD_GEMS } },
      { new: true },
    );
    if (!updated) {
      updated = await User.findOneAndUpdate(
        {
          _id: user._id,
          adRewardDate: today,
          adRewardCount: { $lt: gems.MAX_AD_REWARDS_PER_DAY },
        },
        { $inc: { adRewardCount: 1, gems: gems.AD_REWARD_GEMS } },
        { new: true },
      );
    }
    if (!updated) {
      return res.status(429).json({
        success: false,
        code: "AD_LIMIT_REACHED",
        message: "You've reached today's ad reward limit. Try again tomorrow.",
        data: status,
      });
    }

    await gems.logTransaction(user._id, "ad_reward", gems.AD_REWARD_GEMS, updated.gems, {
      date: today,
    });
    return res.status(200).json({
      success: true,
      message: `+${gems.AD_REWARD_GEMS} gems added.`,
      data: gems.buildStatus(updated, today),
    });
  } catch (error) {
    console.error("Ad reward failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not add your gems." });
  }
};

// @desc  Spend gems to restore a broken streak.
// @route POST /api/gems/revive  { date }
const reviveStreak = async (req, res) => {
  try {
    const today = gems.resolveClientDate(req.body?.date);
    let user = await loadUser(req);
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    ({ user } = await gems.applyMonthlyGrant(user));

    const streak = gems.getStreakState(user, today);
    if (!streak.broken || !streak.revivable) {
      return res.status(400).json({
        success: false,
        code: "NOTHING_TO_REVIVE",
        message: streak.broken
          ? "This streak was missed for too long to revive."
          : "Your streak isn't broken.",
        data: gems.buildStatus(user, today),
      });
    }
    if ((Number(user.gems) || 0) < gems.REVIVE_COST) {
      return res.status(400).json({
        success: false,
        code: "NOT_ENOUGH_GEMS",
        message: `Reviving needs ${gems.REVIVE_COST} gems.`,
        data: gems.buildStatus(user, today),
      });
    }

    // Conditions pin the exact state we evaluated, so a concurrent log or a
    // double tap can't spend gems twice or revive the wrong streak.
    let filter;
    let update;
    let restoredStreak;
    if (streak.mode === "pending") {
      // Nothing logged since the gap: bridge it so today's log continues it.
      restoredStreak = streak.lostStreak;
      filter = {
        _id: user._id,
        gems: { $gte: gems.REVIVE_COST },
        streakCount: user.streakCount,
        lastLoggedDate: user.lastLoggedDate,
      };
      update = {
        $inc: { gems: -gems.REVIVE_COST },
        $set: { lastLoggedDate: gems.fromDayNumber(gems.dayNumber(today) - 1) },
      };
    } else {
      // Already reset by today's log: add the lost streak back on.
      restoredStreak = streak.lostStreak + (Number(user.streakCount) || 0);
      filter = {
        _id: user._id,
        gems: { $gte: gems.REVIVE_COST },
        lostStreakOn: user.lostStreakOn,
        streakCount: user.streakCount,
      };
      update = {
        $inc: { gems: -gems.REVIVE_COST },
        $set: { streakCount: restoredStreak },
        $max: { bestStreak: restoredStreak },
      };
    }
    update.$set = {
      ...update.$set,
      lostStreak: 0,
      lostStreakOn: null,
      lostStreakMissedDays: 0,
    };

    const updated = await User.findOneAndUpdate(filter, update, { new: true });
    if (!updated) {
      return res.status(409).json({
        success: false,
        code: "STATE_CHANGED",
        message: "Your streak just changed. Refresh and try again.",
      });
    }
    await gems.logTransaction(user._id, "streak_revive", -gems.REVIVE_COST, updated.gems, {
      date: today,
      restoredStreak,
      mode: streak.mode,
    });
    return res.status(200).json({
      success: true,
      message: `Streak revived! You're back to ${restoredStreak} day${restoredStreak === 1 ? "" : "s"}.`,
      data: gems.buildStatus(updated, today),
      userStats: {
        streakCount: Number(updated.streakCount) || 0,
        lastLoggedDate: updated.lastLoggedDate,
        gems: Number(updated.gems) || 0,
        bestStreak: Number(updated.bestStreak) || 0,
      },
    });
  } catch (error) {
    console.error("Streak revive failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not revive your streak." });
  }
};

module.exports = { getGemStatus, claimAdReward, reviveStreak };
