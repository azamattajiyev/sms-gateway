const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { generateOtp, formatOtpMessage } = require("../otp");

describe("otp", () => {
  it("generateOtp zero-pads to the requested length", () => {
    const orig = crypto.randomInt;
    crypto.randomInt = () => 42;
    try {
      assert.equal(generateOtp(4), "0042");
      assert.equal(generateOtp(6), "000042");
      assert.equal(generateOtp(8), "00000042");
    } finally {
      crypto.randomInt = orig;
    }
  });

  it("generateOtp returns only digits of the given length", () => {
    for (const length of [4, 5, 6, 7, 8]) {
      const code = generateOtp(length);
      assert.match(code, new RegExp(`^\\d{${length}}$`));
      assert.equal(code.length, length);
    }
  });

  it("generateOtp rejects lengths outside 4–8", () => {
    assert.throws(() => generateOtp(3), /length/);
    assert.throws(() => generateOtp(9), /length/);
    assert.throws(() => generateOtp(4.5), /length/);
  });

  it("formatOtpMessage uses the fixed template", () => {
    assert.equal(formatOtpMessage("Abat", "4821"), "Your Abat code: 4821");
  });

  it("formatOtpMessage trims brandName and strips newlines", () => {
    assert.equal(formatOtpMessage("  Abat  ", "12"), "Your Abat code: 12");
    assert.equal(formatOtpMessage("Abat\nCo", "99"), "Your Abat Co code: 99");
  });

  it("formatOtpMessage rejects empty brandName", () => {
    assert.throws(() => formatOtpMessage("", "1"), /brandName/);
    assert.throws(() => formatOtpMessage("   ", "1"), /brandName/);
    assert.throws(() => formatOtpMessage("\n", "1"), /brandName/);
  });
});
