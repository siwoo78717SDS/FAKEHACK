const express = require("express");
const router = express.Router();
const Announcement = require("../models/Announcement");
const { loadUser, requireAdmin } = require("./_helpers");
const { adminLimiter } = require("../services/security");
const { audit } = require("../services/audit");

router.get("/", async (req, res) => {
  const items = await Announcement.find({}).sort({ createdAt: -1 }).limit(20);
  res.json({ announcements: items });
});

router.post("/", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "Missing title/body" });

  const ann = await Announcement.create({
    title: String(title).slice(0, 120),
    body: String(body).slice(0, 3000),
    createdByUserId: req.user._id,
    createdByUsername: req.user.username
  });

  await audit({
    actor: req.user,
    action: "ADMIN_CREATE_ANNOUNCEMENT",
    details: { title: ann.title },
    ip: req.ip
  });

  res.json({ ok: true, announcement: ann });
});

module.exports = router;
