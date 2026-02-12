const AuditLog = require("../models/AuditLog");

// Works behind proxies too (Render, Vercel, Nginx, Cloudflare, etc.)
function getClientIp(req) {
  if (!req) return "";

  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    // x-forwarded-for can be: "client, proxy1, proxy2"
    return xff.split(",")[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    ""
  );
}

function sanitizeDetails(details, maxChars = 5000) {
  try {
    if (details == null) return {};
    if (typeof details === "string") {
      return details.length > maxChars ? details.slice(0, maxChars) + "..." : details;
    }

    // Avoid huge logs / circular structures by JSON stringify + slice
    const json = JSON.stringify(details);
    if (json.length <= maxChars) return details;

    // If too big, store a trimmed string version instead
    return json.slice(0, maxChars) + "...";
  } catch {
    return { note: "details_unserializable" };
  }
}

/**
 * audit({
 *   req,                    // optional: express req (recommended)
 *   actor,                  // optional: user object (if not using req.user)
 *   action,                 // required string
 *   targetUsername,         // optional string
 *   details,                // optional object/string (will be trimmed)
 *   ip                      // optional string (overrides detected ip)
 * })
 */
async function audit({
  req = null,
  actor = null,
  action,
  targetUsername = "",
  details = {},
  ip = ""
}) {
  if (!action) return;

  const a = actor || req?.user;
  if (!a) return;

  const detectedIp = ip || getClientIp(req);
  const safeDetails = sanitizeDetails(details);

  try {
    await AuditLog.create({
      actorUserId: a._id,
      actorUsername: a.username,
      actorRole: a.role,

      action,
      targetUsername,

      details: {
        ...(typeof safeDetails === "object" && safeDetails !== null ? safeDetails : { value: safeDetails }),
        _meta: req
          ? {
              method: req.method,
              path: req.originalUrl || req.url,
              userAgent: req.headers?.["user-agent"] || ""
            }
          : undefined
      },

      ip: detectedIp
    });
  } catch (e) {
    // Don't crash app if audit log fails
    console.error("Audit log error:", e.message);
  }
}

module.exports = { audit, getClientIp };