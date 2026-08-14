const crypto = require("crypto");
const { ADMIN_USERNAME, ADMIN_PASSWORD, isInsecureAdminConfig } = require("../config");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest();
}

function timingSafeEqualString(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function credentialsMatch(username, password) {
  const userOk = timingSafeEqualString(username, ADMIN_USERNAME);
  const passOk = timingSafeEqualString(password, ADMIN_PASSWORD);
  return userOk && passOk;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect("/login");
}

module.exports = {
  requireAdmin,
  credentialsMatch,
  isInsecureAdminConfig
};
