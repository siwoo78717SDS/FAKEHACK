const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { loadUser } = require("./_helpers");

// GET /api/people?q=abc  -> list users (limited fields)
router.get("/", loadUser, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const filter = {};
  if (q) {
    filter.username = { $regex: "^" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }

  const users = await User.find(filter, "username role level statusMessage createdAt")
    .sort({ username: 1 })
    .limit(50);

  res.json({ users });
});

module.exports = router;
