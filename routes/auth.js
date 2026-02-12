const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { awardAchievement } = require("../services/achievements");
const { loginLimiter } = require("../services/security");

function getClientIp(req) {
  if (!req) return "";

  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    return xff.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "";
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    // express-session provides req.session.regenerate
    req.session.regenerate((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

router.post("/register", async (req, res) => {
  try {
    const { fullName, username, password } = req.body || {};
    if (!fullName || !username || !password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const u = String(username).trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) {
      return res
        .status(400)
        .json({ error: "Username must be 3-20 chars (letters/numbers/_)" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const exists = await User.findOne({ username: u });
    if (exists) return res.status(400).json({ error: "Username already taken" });

    const now = new Date();
    const ip = getClientIp(req);

    const passwordHash = await User.hashPassword(String(password));
    const user = await User.create({
      fullName: String(fullName).slice(0, 80),
      username: u,
      passwordHash,

      // tracking fields
      lastLoginAt: now,
      lastSeenAt: now,
      lastIp: ip
    });

    // Prevent session fixation
    await regenerateSession(req);
    req.session.userId = user._id.toString();
    req.session._lastSeenWriteAt = Date.now(); // aligns with your throttling logic

    return res.json({
      ok: true,
      user: {
        id: user._id,
        username: user.username,
        role: user.role
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Missing username/password" });
    }

    const uname = String(username).trim().toLowerCase();

    // IMPORTANT: do not allow deleted accounts to log in
    const user = await User.findOne({ usernameLower: uname, isDeleted: false })
      .select("+passHash");
    if (!user) {
      // we don't reveal if account exists but is deleted; just say invalid
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const ok = await user.checkPassword(String(password));
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    // Prevent session fixation
    await regenerateSession(req);
    req.session.userId = user._id.toString();
    req.session._lastSeenWriteAt = Date.now();

    // Update login + activity fields
    const now = new Date();
    const ip = getClientIp(req);
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: now, lastSeenAt: now, lastIp: ip } }
    );

    // award first-login achievement (only once)
    await awardAchievement(user._id, "FIRST_LOGIN");

    return res.json({
      ok: true,
      user: {
        id: user._id,
        username: user.username,
        role: user.role
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    if (!req.session) return res.json({ ok: true });

    req.session.destroy((err) => {
      if (err) {
        console.error("logout destroy error:", err);
        return res.status(500).json({ error: "Server error" });
      }

      // default cookie name for express-session
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ loggedIn: false });
  }

  const user = await User.findById(req.session.userId);

  // If user was deleted after session was created, treat as logged out
  if (!user || user.isDeleted) {
    return res.json({ loggedIn: false });
  }

  return res.json({
    loggedIn: true,
    user: {
      id: user._id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      level: user.level,
      coins: user.coins,
      statusMessage: user.statusMessage || "",
      theme: user.theme || "classic",

      // optional: show to the user themself
      lastLoginAt: user.lastLoginAt || null,
      lastSeenAt: user.lastSeenAt || null
    }
  });
});

module.exports = router;