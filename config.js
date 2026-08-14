const os = require("os");
const path = require("path");

function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) ? n : fallback;
}

function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isIPv4(addr) {
  return addr.family === "IPv4" || addr.family === 4;
}

const SKIP_IFACE = /^(lo|utun|bridge|awdl|llw|vnic|docker|vmnet)/;

/** Prefer en0 / en1 (typical Mac Wi‑Fi), then any private IPv4 (skip virtual NICs). */
function getLanIPv4() {
  const ifaces = os.networkInterfaces();
  const preferred = ["en0", "en1"];

  for (const name of preferred) {
    for (const addr of ifaces[name] || []) {
      if (!addr.internal && isIPv4(addr) && isPrivateIPv4(addr.address)) {
        return addr.address;
      }
    }
  }

  for (const [name, list] of Object.entries(ifaces)) {
    if (SKIP_IFACE.test(name)) continue;
    for (const addr of list || []) {
      if (!addr.internal && isIPv4(addr) && isPrivateIPv4(addr.address)) {
        return addr.address;
      }
    }
  }

  return null;
}

function resolveSqlitePath(raw) {
  if (!raw || raw === ":memory:") {
    return raw || path.join(__dirname, "data", "gateway.sqlite");
  }
  if (path.isAbsolute(raw)) return raw;
  return path.join(__dirname, raw);
}

// NODE_ENV: unset → "development". "production" enables secure cookies
// and rejects default SESSION_SECRET / ADMIN_PASSWORD.
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = isProduction
  ? (process.env.ADMIN_PASSWORD || "")
  : (process.env.ADMIN_PASSWORD || "admin");
const SESSION_SECRET = isProduction
  ? process.env.SESSION_SECRET
  : (process.env.SESSION_SECRET || "dev-session-secret");

function isInsecureAdminConfig() {
  if (!isProduction) return false;
  if (!SESSION_SECRET) return true;
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD === "admin") return true;
  return false;
}

/** Refuse to start in production with default or missing admin secrets. */
function assertAdminConfig() {
  if (!isProduction) return;
  if (!SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production");
  }
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD === "admin") {
    throw new Error("ADMIN_PASSWORD must be set to a non-default value in production");
  }
}

module.exports = {
  PORT: envInt("PORT", 3000),
  HOST: process.env.HOST || "0.0.0.0",
  // Device WebSocket REGISTER only — not HTTP send-otp.
  API_KEY: process.env.API_KEY || "dev-api-key",
  MAX_SMS_PER_DEVICE: envInt("MAX_SMS_PER_DEVICE", 500),
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  MAX_QUEUE_SIZE: envInt("MAX_QUEUE_SIZE", 1000),
  // Default: sms-gateway/data/gateway.sqlite (relative to this file).
  SQLITE_PATH: resolveSqlitePath(process.env.SQLITE_PATH),
  NODE_ENV,
  SESSION_SECRET,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  isInsecureAdminConfig,
  assertAdminConfig,
  getLanIPv4
};
