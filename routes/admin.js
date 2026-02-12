const express = require("express");
const router = express.Router();

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const IpBan = require("../models/IpBan"); // NEW: IP ban model (you'll add this file)

const { loadUser, requireAdmin, getClientIp } = require("./_helpers");
const { adminLimiter } = require("../services/security");
const { audit } = require("../services/audit");

/**
 * Admin: list users for "User Profile Database"
 * Returns lastSeenAt / lastLoginAt / lastIp so admin UI can display them.
 */
router.get("/users", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  const users = await User.find(
    {},
    {
      username: 1,
      fullName: 1,
      role: 1,
      level: 1,
      coins: 1,
      bans: 1,

      // tracking fields
      lastSeenAt: 1,
      lastLoginAt: 1,
      lastIp: 1,

      createdAt: 1,
      achievementPoints: 1,

      // NEW: include isDeleted so admin UI can show it
      isDeleted: 1
    }
  )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json({ users });
});

// Toggle ban flags
router.post("/users/ban-flags", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const { username, chatBan, coinsBan, reason } = req.body || {};
  if (!username) return res.status(400).json({ error: "Missing username" });

  const target = await User.findOne({ username: String(username).trim() });
  if (!target) return res.status(404).json({ error: "User not found" });

  if (!target.bans) target.bans = {};
  if (typeof chatBan === "boolean") target.bans.isBannedFromChat = chatBan;
  if (typeof coinsBan === "boolean") target.bans.isBannedFromCoins = coinsBan;
  if (typeof reason === "string") target.bans.reason = reason.slice(0, 200);
  target.bans.updatedAt = new Date();

  await target.save();

  await audit({
    actor: req.user,
    action: "ADMIN_SET_BANS",
    targetUsername: target.username,
    details: { chatBan: !!chatBan, coinsBan: !!coinsBan, reason: reason || "" },
    ip: getClientIp(req)
  });

  res.json({ ok: true, username: target.username, bans: target.bans });
});

// Set role
router.post("/users/set-role", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const { username, role } = req.body || {};
  const allowed = ["user", "mod", "admin"];
  if (!username || !allowed.includes(role)) return res.status(400).json({ error: "Invalid request" });

  const target = await User.findOne({ username: String(username).trim() });
  if (!target) return res.status(404).json({ error: "User not found" });

  // prevent removing your own admin accidentally
  if (target._id.toString() === req.user._id.toString() && role !== "admin") {
    return res.status(400).json({ error: "You cannot remove your own admin role" });
  }

  target.role = role;
  await target.save();

  await audit({
    actor: req.user,
    action: "ADMIN_SET_ROLE",
    targetUsername: target.username,
    details: { role },
    ip: getClientIp(req)
  });

  res.json({ ok: true, username: target.username, role: target.role });
});

// Set level
router.post("/users/set-level", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const { username, level } = req.body || {};
  const lvl = Number(level);
  if (!username || !Number.isInteger(lvl) || lvl < 1 || lvl > 10) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const target = await User.findOne({ username: String(username).trim() });
  if (!target) return res.status(404).json({ error: "User not found" });

  target.level = lvl;
  await target.save();

  await audit({
    actor: req.user,
    action: "ADMIN_SET_LEVEL",
    targetUsername: target.username,
    details: { level: lvl },
    ip: getClientIp(req)
  });

  res.json({ ok: true, username: target.username, level: target.level });
});

/**
 * NEW: Soft delete a user account (admin-only).
 * - Sets isDeleted = true
 * - Zeroes coins
 * - Bans from chat + coins
 * - Optionally resets unlocks / status
 */
router.post("/users/delete", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  try {
    const { username } = req.body || {};
    const cleanName = String(username || "").trim();
    if (!cleanName) return res.status(400).json({ error: "Missing username" });

    const target = await User.findOne({ username: cleanName });
    if (!target) return res.status(404).json({ error: "User not found" });

    // prevent deleting yourself
    if (target._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    target.isDeleted = true;
    target.coins = 0;

    if (!target.bans) target.bans = {};
    target.bans.isBannedFromChat = true;
    target.bans.isBannedFromCoins = true;
    target.bans.reason = "Account deleted by admin";
    target.bans.updatedAt = new Date();

    // optional: reset unlocks / status to keep UI clean
    if (target.unlocks) {
      target.unlocks.chat = false;
      target.unlocks.groupChat = false;
      target.unlocks.createGroup = false;
      target.unlocks.imageUpload = false;
    }
    target.statusMessage = "[DELETED]";

    await target.save();

    await audit({
      actor: req.user,
      action: "ADMIN_DELETE_USER",
      targetUsername: target.username,
      details: {},
      ip: getClientIp(req)
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /admin/users/delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * NEW: Full ban (user + IP).
 * - Bans user from chat + coins with reason
 * - Creates/updates IpBan for their lastIp (or current request IP)
 */
router.post("/users/full-ban", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  try {
    const { username, reason } = req.body || {};
    const cleanName = String(username || "").trim();
    if (!cleanName) return res.status(400).json({ error: "Missing username" });

    const target = await User.findOne({ username: cleanName });
    if (!target) return res.status(404).json({ error: "User not found" });

    const banReason = reason || "Full ban";

    if (!target.bans) target.bans = {};
    target.bans.isBannedFromChat = true;
    target.bans.isBannedFromCoins = true;
    target.bans.reason = banReason;
    target.bans.updatedAt = new Date();
    await target.save();

    // choose IP to ban: prefer user's lastIp, fallback to current request IP
    const ipToBan = target.lastIp || getClientIp(req);

    if (ipToBan) {
      await IpBan.updateOne(
        { ip: ipToBan },
        {
          $set: {
            ip: ipToBan,
            reason: banReason,
            // null = permanent ban; you can change to Date.now() + duration if you ever add temp bans
            expiresAt: null
          }
        },
        { upsert: true }
      );
    }

    await audit({
      actor: req.user,
      action: "ADMIN_FULL_BAN",
      targetUsername: target.username,
      details: { reason: banReason, ip: ipToBan || "" },
      ip: getClientIp(req)
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("POST /admin/users/full-ban error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Audit logs
router.get("/audit", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ logs });
});

module.exports = router;