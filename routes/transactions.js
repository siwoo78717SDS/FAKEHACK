const express = require("express");
const router = express.Router();
const CoinTransaction = require("../models/CoinTransaction");
const { loadUser, requireAdmin } = require("./_helpers");
const { adminLimiter } = require("../services/security");

router.get("/me", loadUser, async (req, res) => {
  const tx = await CoinTransaction.find({
    $or: [
      { fromUserId: req.user._id },
      { toUserId: req.user._id }
    ]
  }).sort({ createdAt: -1 }).limit(50);

  res.json({ transactions: tx });
});

router.get("/admin/all", adminLimiter, loadUser, requireAdmin, async (req, res) => {
  const { username } = req.query;
  const filter = {};
  if (username) {
    filter.$or = [{ fromUsername: username }, { toUsername: username }];
  }
  const tx = await CoinTransaction.find(filter).sort({ createdAt: -1 }).limit(200);
  res.json({ transactions: tx });
});

module.exports = router;
