const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const rateLimit = require("../rate-limit");
const { OTP_RATE_LIMIT_MS } = require("../config");

describe("rate-limit", () => {
  beforeEach(() => {
    rateLimit.reset();
  });

  it("normalizePhone trims and strips a leading +", () => {
    assert.equal(rateLimit.normalizePhone("+77001234567"), "77001234567");
    assert.equal(rateLimit.normalizePhone("77001234567"), "77001234567");
    assert.equal(rateLimit.normalizePhone("  +77001234567  "), "77001234567");
    assert.equal(rateLimit.normalizePhone("  77001234567  "), "77001234567");
  });

  it("check allows a phone that has not been recorded", () => {
    assert.deepEqual(rateLimit.check("+77001234567", 1000), { allowed: true });
  });

  it("rejects a second check inside the window and reports retryAfterSec", () => {
    const t0 = 1_000_000;
    rateLimit.record("+77001234567", t0);

    const blocked = rateLimit.check("77001234567", t0);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSec, Math.ceil(OTP_RATE_LIMIT_MS / 1000));

    const almost = rateLimit.check("+77001234567", t0 + OTP_RATE_LIMIT_MS - 1);
    assert.equal(almost.allowed, false);
    assert.equal(almost.retryAfterSec, 1);
  });

  it("allows again once the window elapses", () => {
    const t0 = 5_000_000;
    rateLimit.record("77001112233", t0);
    assert.equal(rateLimit.check("77001112233", t0 + OTP_RATE_LIMIT_MS - 1).allowed, false);
    assert.deepEqual(rateLimit.check("+77001112233", t0 + OTP_RATE_LIMIT_MS), { allowed: true });
  });

  it("treats different phones independently", () => {
    const t0 = 9_000_000;
    rateLimit.record("+77001110001", t0);
    assert.equal(rateLimit.check("+77001110001", t0).allowed, false);
    assert.deepEqual(rateLimit.check("+77001110002", t0), { allowed: true });
  });

  it("reset clears recorded phones and the injected clock", () => {
    let now = 1_000;
    rateLimit.setNow(() => now);
    rateLimit.record("+15551234567", now);
    assert.equal(rateLimit.check("+15551234567").allowed, false);

    rateLimit.reset();
    assert.deepEqual(rateLimit.check("+15551234567"), { allowed: true });
    assert.equal(rateLimit.size(), 0);
  });

  it("cleanupExpired removes stale entries without waiting for check", () => {
    const t0 = 2_000_000;
    rateLimit.record("+77001112233", t0);
    rateLimit.record("+77001112234", t0 + 10);
    assert.equal(rateLimit.size(), 2);

    rateLimit.cleanupExpired(t0 + OTP_RATE_LIMIT_MS - 1);
    assert.equal(rateLimit.size(), 2);

    rateLimit.cleanupExpired(t0 + OTP_RATE_LIMIT_MS);
    assert.equal(rateLimit.size(), 1);

    rateLimit.cleanupExpired(t0 + 10 + OTP_RATE_LIMIT_MS);
    assert.equal(rateLimit.size(), 0);
  });

  it("cleanupExpired uses the injected clock when now is omitted", () => {
    let now = 3_000_000;
    rateLimit.setNow(() => now);
    rateLimit.record("+15550001111");
    assert.equal(rateLimit.size(), 1);

    now += OTP_RATE_LIMIT_MS - 1;
    rateLimit.cleanupExpired();
    assert.equal(rateLimit.size(), 1);

    now += 1;
    rateLimit.cleanupExpired();
    assert.equal(rateLimit.size(), 0);
  });
});
