const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  LOCALES,
  DEFAULT_LOCALE,
  t,
  parseLangCookie,
  resolveLocale,
  i18nMiddleware
} = require("../public-site/i18n");

function mockRes() {
  const cookies = [];
  return {
    locals: {},
    cookies,
    cookie(name, value, opts) {
      cookies.push({ name, value, opts });
    }
  };
}

describe("i18n", () => {
  it("allowlists en, ru, tk and defaults to ru", () => {
    assert.deepEqual(LOCALES, ["en", "ru", "tk"]);
    assert.equal(DEFAULT_LOCALE, "ru");
  });

  it("t looks up nested chrome keys", () => {
    assert.equal(t("ru", "nav.home"), "Главная");
    assert.equal(t("en", "nav.home"), "Home");
    assert.equal(t("tk", "nav.home"), "Baş sahypa");
    assert.equal(t("en", "nav.docs"), "Documentation");
    assert.equal(t("tk", "contact.hoursDefault"), "Duş–Anna 10:00–18:00 (UTC+5)");
  });

  it("t falls back to ru when a key is missing in the active locale", () => {
    assert.equal(t("en", "fallbackProbe"), "Your {brandName} code: {code}");
    assert.equal(t("tk", "fallbackProbe"), "Your {brandName} code: {code}");
    assert.equal(t("en", "no.such.key"), "no.such.key");
  });

  it("t returns a string containing {brandName} unchanged", () => {
    assert.equal(t("ru", "fallbackProbe"), "Your {brandName} code: {code}");
    assert.equal(t("en", "Your {brandName} code: {code}"), "Your {brandName} code: {code}");
  });

  it("parseLangCookie reads public.lang and ignores other cookies", () => {
    assert.equal(parseLangCookie("public.lang=en"), "en");
    assert.equal(parseLangCookie("admin.sid=abc; public.lang=tk"), "tk");
    assert.equal(parseLangCookie("  public.lang=ru  "), "ru");
    assert.equal(parseLangCookie("foo=bar"), null);
    assert.equal(parseLangCookie(""), null);
    assert.equal(parseLangCookie(undefined), null);
  });

  it("resolveLocale prefers a valid query lang over cookie over ru", () => {
    assert.equal(
      resolveLocale({ query: { lang: "en" }, headers: { cookie: "public.lang=tk" } }),
      "en"
    );
    assert.equal(
      resolveLocale({ query: {}, headers: { cookie: "public.lang=tk" } }),
      "tk"
    );
    assert.equal(resolveLocale({ query: {}, headers: {} }), "ru");
    assert.equal(resolveLocale({}), "ru");
  });

  it("resolveLocale ignores invalid or array query lang and does not use them", () => {
    assert.equal(
      resolveLocale({ query: { lang: "fr" }, headers: { cookie: "public.lang=en" } }),
      "en"
    );
    assert.equal(
      resolveLocale({ query: { lang: "../x" }, headers: {} }),
      "ru"
    );
    assert.equal(
      resolveLocale({ query: { lang: ["en", "ru"] }, headers: { cookie: "public.lang=tk" } }),
      "tk"
    );
    assert.equal(
      resolveLocale({ query: { lang: "EN" }, headers: {} }),
      "ru"
    );
  });

  it("resolveLocale ignores a cookie that is not in the allowlist", () => {
    assert.equal(
      resolveLocale({ query: {}, headers: { cookie: "public.lang=fr" } }),
      "ru"
    );
    assert.equal(
      resolveLocale({ query: {}, headers: { cookie: "public.lang=../x" } }),
      "ru"
    );
  });

  it("i18nMiddleware sets public.lang only for a valid query lang", () => {
    const res = mockRes();
    i18nMiddleware({ query: { lang: "en" }, headers: {} }, res, () => {});
    assert.equal(res.locals.locale, "en");
    assert.deepEqual(res.locals.locales, LOCALES);
    assert.equal(res.locals.t("nav.home"), "Home");
    assert.equal(res.cookies.length, 1);
    assert.equal(res.cookies[0].name, "public.lang");
    assert.equal(res.cookies[0].value, "en");
    assert.equal(res.cookies[0].opts.httpOnly, true);
    assert.equal(res.cookies[0].opts.sameSite, "lax");
    assert.equal(res.cookies[0].opts.path, "/");
    assert.equal(res.cookies[0].opts.maxAge, 365 * 24 * 60 * 60 * 1000);
    assert.equal(res.cookies[0].opts.secure, false);
  });

  it("i18nMiddleware does not set a cookie for invalid query lang", () => {
    const res = mockRes();
    i18nMiddleware(
      { query: { lang: "fr" }, headers: { cookie: "public.lang=tk" } },
      res,
      () => {}
    );
    assert.equal(res.locals.locale, "tk");
    assert.equal(res.locals.t("nav.home"), "Baş sahypa");
    assert.equal(res.cookies.length, 0);
  });

  it("i18nMiddleware does not set a cookie for array query lang", () => {
    const res = mockRes();
    i18nMiddleware({ query: { lang: ["en"] }, headers: {} }, res, () => {});
    assert.equal(res.locals.locale, "ru");
    assert.equal(res.cookies.length, 0);
  });
});
