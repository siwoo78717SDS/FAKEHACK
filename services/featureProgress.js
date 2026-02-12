const User = require("../models/User");
const { FEATURE_MILESTONES } = require("../config/features");

/**
 * Award AP once per unique code (prevents double-paying).
 * Uses a query condition so it's safe even if two requests happen at the same time.
 */
async function awardApOnce(userId, code, apAmount, meta = {}) {
  const cleanCode = String(code || "").trim();
  const ap = Number(apAmount) || 0;

  if (!cleanCode || ap <= 0) return { ok: false, awarded: false };

  const res = await User.updateOne(
    { _id: userId, awardedAchievements: { $ne: cleanCode } },
    {
      $addToSet: { awardedAchievements: cleanCode },
      $inc: { achievementPoints: ap }
    }
  );

  const modified = res.modifiedCount ?? res.nModified ?? 0;
  return { ok: true, awarded: modified === 1 };
}

/**
 * Increment a stat and award AP milestones when thresholds are met.
 * Used by DM + Groups routes:
 *   recordFeatureAction(userId, "chat", "dmMessagesSent", 1)
 */
async function recordFeatureAction(userId, featureKey, statKey, delta = 1) {
  const d = Number(delta);
  if (!Number.isFinite(d) || d === 0) return;

  const fKey = String(featureKey || "").trim();
  const sKey = String(statKey || "").trim();
  if (!fKey || !sKey) return;

  // Increment stat
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { [`stats.${sKey}`]: d } },
    { new: true, select: "stats awardedAchievements achievementPoints" }
  ).lean();

  const newValue = Number(user?.stats?.[sKey] || 0);

  // Award milestones (if configured)
  const milestones = FEATURE_MILESTONES?.[fKey]?.[sKey] || [];
  for (const m of milestones) {
    if (!m || typeof m !== "object") continue;

    const count = Number(m.count);
    const ap = Number(m.ap);
    const code = String(m.code || "").trim();

    if (!code || !Number.isFinite(count) || !Number.isFinite(ap)) continue;

    if (newValue >= count) {
      await awardApOnce(userId, code, ap, {
        featureKey: fKey,
        statKey: sKey,
        countReached: count
      });
    }
  }

  return { ok: true, stat: sKey, value: newValue };
}

module.exports = { recordFeatureAction, awardApOnce };