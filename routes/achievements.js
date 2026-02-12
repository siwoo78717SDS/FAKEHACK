const express = require("express");
const router = express.Router();
const { loadUser } = require("./_helpers");
const { ACHIEVEMENTS } = require("../services/achievements");

router.get("/me", loadUser, async (req, res) => {
  res.json({ achievements: req.user.achievements || [] });
});

router.get("/defs", async (req, res) => {
  // helpful for "locked/unlocked" UI
  res.json({ defs: Object.values(ACHIEVEMENTS) });
});

module.exports = router;
