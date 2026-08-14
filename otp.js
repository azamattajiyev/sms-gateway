const crypto = require("crypto");

function generateOtp(length) {
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new Error("length must be an integer between 4 and 8");
  }
  const n = crypto.randomInt(0, 10 ** length);
  return String(n).padStart(length, "0");
}

function formatOtpMessage(brandName, code) {
  const brand = String(brandName ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!brand) {
    throw new Error("brandName must be a non-empty string");
  }
  return `Your ${brand} code: ${code}`;
}

module.exports = { generateOtp, formatOtpMessage };
