const express = require("express");
const router = express.Router();
const BugReport = require("../models/BugReport");
const { loadUser, requireAdmin } = require("./_helpers");
const { adminLimiter } = require("../services/security");
const { awardAchievement } = require("../services/achievements");
const { audit } = require("../services/audit");

// List mine
router.get("/mine", loadUser, async (req, res) => {
  const bugs = await BugReport.find({ creatorUserId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ bugs });
});

// Create
router.post("/", loadUser, async (req, res) => {
  const { title, description, screenshotUrl } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: "Title and description required" });

  const bug = await BugReport.create({
    creatorUserId: req.user._id,
    creatorUsername: req.user.username,
    title: String(title).slice(0, 200),
    description: String(description).slice(0, 5000),
    screenshotUrl: String(screenshotUrl || "").slice(0, 300),
    messages: [{
      fromUserId: req.user._id,
      fromUsername: req.user.username,
      roleAtTime: req.user.role,
      text: String(description).slice(0, 5000)
    }],
    lastUpdatedAt: new Date()
  });

  await awardAchievement(req.user._id, "FIRST_BUG_REPORT");

  res.json({ ok: true, bug });
});

// Get one (owner or admin)
router.get("/:id", loadUser, async (req, res) => {
  const bug = await BugReport.findById(req.params.id);
  if (!bug) return res.status(404).json({ error: "Bug not found" });

  const isOwner = bug.creatorUserId.toString() === req.user._id.toString();
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) return res.status(403).json({ error: "Forbidden" });

  res.json({ bug });
});

// Reply (owner or admin)
router.post("/:id/reply", loadUser, async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Text required" });

  const bug = await BugReport.findById(req.params.id);
  if (!bug) return res.status(404).json({ error: "Bug not found" });

  const isOwner = bug.creatorUserId.toString() === req.user._id.toString();
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) return res.status(403).json({ error: "Forbidden" });

  bug.messages.push({
    fromUserId: req.user._id,
    fromUsername: req.user.username,
    roleAtTime: req.user.role,
    text: String(text).slice(0, 5000)
  });
  bug.lastUpdatedAt = new Date();
  await bug.save();

  if (isAdmin) {
    await audit({
      actor: req.user,
      action: "ADMIN_REPLY_BUG",
      targetUsername: bug.creatorUsername,
      details: { bugId: bug._id.toString() },
      ip: req.ip
    });
  }

  res.json({ ok: true, bug });
});

// Admin list
router.get("/admin/all", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const { status } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const bugs = await BugReport.find(filter).sort({ lastUpdatedAt: -1 }).limit(100);
  res.json({ bugs });
});

// Admin status change
router.post("/admin/:id/status", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  const allowed = ["open", "in-progress", "resolved", "closed"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });

  const bug = await BugReport.findById(req.params.id);
  if (!bug) return res.status(404).json({ error: "Bug not found" });

  bug.status = status;
  bug.lastUpdatedAt = new Date();
  await bug.save();

  await audit({
    actor: req.user,
    action: "ADMIN_SET_BUG_STATUS",
    targetUsername: bug.creatorUsername,
    details: { bugId: bug._id.toString(), status },
    ip: req.ip
  });

  res.json({ ok: true, bug });
});

module.exports = router;
