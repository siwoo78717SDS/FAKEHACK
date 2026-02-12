const User = require("../models/User");
const CoinTransaction = require("../models/CoinTransaction");

const ACHIEVEMENTS = {
  FIRST_LOGIN: { code: "FIRST_LOGIN", title: "First Login", coinsReward: 10 },
  LEVEL2_UNLOCKED: { code: "LEVEL2_UNLOCKED", title: "Unlocked Level 2", coinsReward: 50 },
  LEVEL3_UNLOCKED: { code: "LEVEL3_UNLOCKED", title: "Unlocked Level 3", coinsReward: 75 },
  FIRST_BUG_REPORT: { code: "FIRST_BUG_REPORT", title: "First Bug Report", coinsReward: 25 }
};

/**
 * Award an achievement once.
 * - Race-safe: prevents duplicate awards under concurrency.
 * - If user is coin-banned, achievement is still granted but no coins are added.
 *
 * Returns:
 * - updated user doc if awarded OR already had it
 * - null if user not found or achievement code invalid
 */
async function awardAchievement(userId, code) {
  const def = ACHIEVEMENTS[code];
  if (!def) return null;

  const now = new Date();
  const reward = Number(def.coinsReward) || 0;

  // 1) Try: award achievement + coins (only if not coin-banned)
  // This is atomic and prevents double-award.
  let user = await User.findOneAndUpdate(
    {
      _id: userId,
      "achievements.code": { $ne: def.code },
      "bans.isBannedFromCoins": { $ne: true }
    },
    {
      $push: { achievements: { code: def.code, title: def.title, earnedAt: now } },
      ...(reward > 0 ? { $inc: { coins: reward } } : {})
    },
    { new: true }
  );

  if (user) {
    // Create transaction only when we actually gave coins
    if (reward > 0) {
      await CoinTransaction.create({
        type: "achievement_reward",
        toUserId: user._id,
        toUsername: user.username,
        amount: reward,
        description: `Achievement: ${def.title}`
      });
    }
    return user;
  }

  // 2) If that didn't match, it might be because the user is coin-banned.
  // Try: award achievement WITHOUT coins (still atomic / no duplicates).
  user = await User.findOneAndUpdate(
    {
      _id: userId,
      "achievements.code": { $ne: def.code }
    },
    {
      $push: { achievements: { code: def.code, title: def.title, earnedAt: now } }
    },
    { new: true }
  );

  if (user) return user;

  // 3) If it still didn't match, the user either:
  // - doesn't exist, OR
  // - already has the achievement.
  // Return the user (like your old version did).
  return await User.findById(userId);
}

module.exports = { ACHIEVEMENTS, awardAchievement };