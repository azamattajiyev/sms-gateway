const { NODE_ENV } = require("../config");

const LOCALES = ["en", "ru", "tk"];
const DEFAULT_LOCALE = "ru";
const COOKIE_NAME = "public.lang";
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const catalogs = {
  en: require("./locales/en.json"),
  ru: require("./locales/ru.json"),
  tk: require("./locales/tk.json")
};

function isAllowedLocale(value) {
  return typeof value === "string" && LOCALES.includes(value);
}

function lookup(catalog, key) {
  if (!catalog || typeof key !== "string" || !key) return undefined;
  let cur = catalog;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, part)) {
      return undefined;
    }
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

function t(locale, key) {
  const fromLocale = lookup(catalogs[locale], key);
  if (fromLocale !== undefined) return fromLocale;
  if (locale !== DEFAULT_LOCALE) {
    const fromDefault = lookup(catalogs[DEFAULT_LOCALE], key);
    if (fromDefault !== undefined) return fromDefault;
  }
  return key;
}

function parseLangCookie(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader) return null;
  let found = null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    found = trimmed.slice(eq + 1).trim();
  }
  return found;
}

function resolveLocale(req) {
  const query = (req && req.query) || {};
  if (isAllowedLocale(query.lang)) {
    return query.lang;
  }
  const headers = (req && req.headers) || {};
  const fromCookie = parseLangCookie(headers.cookie);
  if (isAllowedLocale(fromCookie)) {
    return fromCookie;
  }
  return DEFAULT_LOCALE;
}

function i18nMiddleware(req, res, next) {
  const locale = resolveLocale(req);
  const queryLang = req.query && req.query.lang;
  if (isAllowedLocale(queryLang)) {
    res.cookie(COOKIE_NAME, locale, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_MS,
      secure: NODE_ENV === "production"
    });
  }
  res.locals.locale = locale;
  res.locals.locales = LOCALES;
  res.locals.t = (key) => t(locale, key);
  next();
}

module.exports = {
  LOCALES,
  DEFAULT_LOCALE,
  t,
  parseLangCookie,
  resolveLocale,
  i18nMiddleware
};
