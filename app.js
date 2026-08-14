const path = require("path");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const expressLayouts = require("express-ejs-layouts");
const { CORS_ORIGIN, MAX_QUEUE_SIZE, SESSION_SECRET, NODE_ENV } = require("./config");
const { getDb } = require("./db");
const { accountApiKeyGuard } = require("./middleware");
const accounts = require("./accounts");
const queue = require("./queue");
const { generateOtp, formatOtpMessage } = require("./otp");
const { requireAdmin } = require("./admin/middleware");
const publicRoutes = require("./public-site/routes");
const authRoutes = require("./admin/auth-routes");
const adminRoutes = require("./admin/routes");
const accountsRoutes = require("./admin/accounts-routes");
const devicesRoutes = require("./admin/devices-routes");

function corsOptions() {
  const raw = (CORS_ORIGIN || "").trim();
  if (!raw || raw === "*") {
    return {};
  }
  const origins = raw.split(",").map((o) => o.trim()).filter(Boolean);
  return { origin: origins.length === 1 ? origins[0] : origins };
}

/** E.164-ish: optional +, 8–16 digits */
function isValidPhone(phone) {
  if (typeof phone !== "string") return false;
  const trimmed = phone.trim();
  return /^\+?\d{8,16}$/.test(trimmed);
}

function createApp() {
  getDb();
  const app = express();

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "SAMEORIGIN"
    });
    next();
  });

  app.use(cors(corsOptions()));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, "public")));

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(expressLayouts);
  app.set("layout", "layouts/admin");

  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "admin.sid",
    cookie: {
      httpOnly: true,
      secure: NODE_ENV === "production"
    }
  }));

  app.use((req, res, next) => {
    res.locals.user = req.session && req.session.user;
    res.locals.currentPath = req.path;
    res.locals.flash = (req.session && req.session.flash) || null;
    if (req.session) {
      delete req.session.flash;
    }
    next();
  });

  app.use(publicRoutes);
  app.use(authRoutes);
  app.use("/admin/accounts", requireAdmin, accountsRoutes);
  app.use("/admin/devices", requireAdmin, devicesRoutes);
  app.use("/admin", requireAdmin, adminRoutes);

  app.post("/api/send-otp", accountApiKeyGuard, (req, res) => {
    const phone = req.body && req.body.phone;

    if (phone === undefined || phone === null || (typeof phone === "string" && !phone.trim())) {
      return res.status(400).json({ error: "phone required" });
    }

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: "invalid phone" });
    }

    if (queue.size() >= MAX_QUEUE_SIZE) {
      return res.status(503).json({ error: "queue full" });
    }

    if (!accounts.tryConsumeQuota(req.account.id)) {
      return res.status(429).json({ error: "quota exceeded" });
    }

    const code = generateOtp(req.account.otpLength);
    const message = formatOtpMessage(req.account.brandName, code);
    const trimmed = phone.trim();

    queue.addToQueue({
      phone: trimmed,
      message,
      accountId: req.account.id
    });

    res.json({ status: "queued", code });
  });

  return app;
}

module.exports = { createApp };
