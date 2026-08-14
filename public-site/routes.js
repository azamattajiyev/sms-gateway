const express = require("express");
const { publicContact } = require("../config");
const { i18nMiddleware } = require("./i18n");

const router = express.Router();

function publicPage(title) {
  return {
    layout: "layouts/public",
    title,
    contact: publicContact
  };
}

router.use(i18nMiddleware);

router.get("/", (req, res) => {
  res.render("pages/public/home", publicPage(res.locals.t("meta.homeTitle")));
});

router.get("/docs", (req, res) => {
  res.render("pages/public/docs", publicPage(res.locals.t("meta.docsTitle")));
});

module.exports = router;
