const express = require("express");
const router = express.Router();
const { loadUser } = require("./_helpers");

router.post("/status", loadUser, async (req, res) => {
  if (req.user.level < 3) {
    return res.status(403).json({ error: "Level 3 required" });
  }
  const { statusMessage } = req.body || {};
  req.user.statusMessage = String(statusMessage || "").slice(0, 120);
  await req.user.save();
  res.json({ ok: true, statusMessage: req.user.statusMessage });
});

router.post("/theme", loadUser, async (req, res) => {
  if (req.user.level < 3) {
    return res.status(403).json({ error: "Level 3 required" });
  }
  const { theme } = req.body || {};
  const allowed = ["classic", "green", "amber"];
  if (!allowed.includes(theme)) return res.status(400).json({ error: "Invalid theme" });
  req.user.theme = theme;
  await req.user.save();
  res.json({ ok: true, theme: req.user.theme });
});

module.exports = router;
