const accounts = require("./accounts");

function accountApiKeyGuard(req, res, next) {
  const key = req.headers["x-api-key"];
  const account = accounts.findByApiKey(key);
  if (!account || !account.enabled) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.account = account;
  next();
}

module.exports.accountApiKeyGuard = accountApiKeyGuard;
