const { OTP_RATE_LIMIT_MS } = require("./config");

/** phone digits → last successful enqueue timestamp (ms) */
const lastSentAt = new Map();
let nowFn = () => Date.now();

/** Trim, then strip a single leading `+` so +7700… and 7700… share a key. */
function normalizePhone(phone) {
  return String(phone ?? "").trim().replace(/^\+/, "");
}

/** Test helper: freeze or replace the clock used when `now` is omitted. */
function setNow(now) {
  nowFn = typeof now === "function" ? now : () => Number(now);
}

function size() {
  return lastSentAt.size;
}

function cleanupExpired(now = nowFn()) {
  for (const [key, last] of lastSentAt) {
    if (now - last >= OTP_RATE_LIMIT_MS) {
      lastSentAt.delete(key);
    }
  }
}

function check(phone, now = nowFn()) {
  const key = normalizePhone(phone);
  const last = lastSentAt.get(key);
  if (last === undefined) {
    return { allowed: true };
  }
  const elapsed = now - last;
  if (elapsed >= OTP_RATE_LIMIT_MS) {
    lastSentAt.delete(key);
    return { allowed: true };
  }
  const retryAfterSec = Math.max(1, Math.ceil((OTP_RATE_LIMIT_MS - elapsed) / 1000));
  return { allowed: false, retryAfterSec };
}

function record(phone, now = nowFn()) {
  lastSentAt.set(normalizePhone(phone), now);
}

function reset() {
  lastSentAt.clear();
  nowFn = () => Date.now();
}

// Background sweep every 30s (unref so tests/process can exit). Uses nowFn.
const cleanupTimer = setInterval(() => cleanupExpired(), 30000);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

module.exports = {
  normalizePhone,
  check,
  record,
  reset,
  setNow,
  cleanupExpired,
  size
};
