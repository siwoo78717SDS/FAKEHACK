const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { loadUser } = require("./_helpers");

const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadDir);
  },
  filename: function (_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const safeExt = [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext) ? ext : ".png";
    const name = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9) + safeExt;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});

// For chat images: requires level >= 2 (feature unlock)
router.post("/chat-image", loadUser, upload.single("file"), async (req, res) => {
  if (req.user.level < 2) {
    return res.status(403).json({ error: "Level 2 required to upload chat images" });
  }
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ ok: true, url: "/uploads/" + req.file.filename });
});

// For bug screenshots: allowed for any logged-in user
router.post("/bug-screenshot", loadUser, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ ok: true, url: "/uploads/" + req.file.filename });
});

module.exports = router;
