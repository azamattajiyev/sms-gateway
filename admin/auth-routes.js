const express = require("express");
const { ADMIN_USERNAME } = require("../config");
const { credentialsMatch, isInsecureAdminConfig } = require("./middleware");

const router = express.Router();

function renderLogin(res, error) {
  res.render("pages/auth/login", {
    layout: "layouts/auth",
    title: "Login",
    error: error || null
  });
}

router.get("/login", (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect("/admin");
  }
  return renderLogin(res);
});

router.post("/login", (req, res) => {
  if (isInsecureAdminConfig()) {
    console.error("Admin login disabled: set ADMIN_PASSWORD to a non-default value in production");
    return renderLogin(res, "Invalid username or password");
  }

  const username = req.body && req.body.username;
  const password = req.body && req.body.password;

  if (!credentialsMatch(username, password)) {
    return renderLogin(res, "Invalid username or password");
  }

  req.session.user = { username: ADMIN_USERNAME };
  req.session.save((err) => {
    if (err) {
      console.error("Failed to save admin session");
      return renderLogin(res, "Invalid username or password");
    }
    res.redirect("/admin");
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("admin.sid");
    res.redirect("/login");
  });
});

module.exports = router;
