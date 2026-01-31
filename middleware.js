const { API_KEY } = require("./config");

module.exports.apiKeyGuard = (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

