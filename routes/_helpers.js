const User = require("../models/User");

function getClientIp(req) {
  if (!req) return "";

  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    // "client, proxy1, proxy2" -> take the first one
    return xff.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "";
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

/**
 * Loads req.user from session userId.
 * Also updates lastSeenAt + lastIp (throttled to once per 60 seconds per session).
 */
async function loadUser(req, res, next) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      // session points to missing user -> clear session
      try {
        req.session.destroy(() => {});
      } catch {}
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;

    // ---- lastSeenAt / lastIp tracking (throttled) ----
    const nowMs = Date.now();
    const lastWriteMs = Number(req.session._lastSeenWriteAt || 0);

    // Only write at most once every 60 seconds per session
    if (!lastWriteMs || nowMs - lastWriteMs >= 60 * 1000) {
      const ip = getClientIp(req);

      // Best-effort update (don’t block the request)
      User.updateOne(
        { _id: user._id },
        {
          $set: {
            lastSeenAt: new Date(nowMs),
            lastIp: ip
          }
        }
      ).catch((err) => console.error("lastSeenAt/lastIp update error:", err.message));

      req.session._lastSeenWriteAt = nowMs;
    }

    next();
  } catch (err) {
    console.error("loadUser error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

function requireModOrAdmin(req, res, next) {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "mod")) {
    return res.status(403).json({ error: "Mod/Admin only" });
  }
  next();
}

module.exports = {
  requireLogin,
  loadUser,
  requireAdmin,
  requireModOrAdmin,
  getClientIp
};