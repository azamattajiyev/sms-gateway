const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { openDb, closeDb } = require("../db");
const { createApp } = require("../app");
const { ADMIN_USERNAME, ADMIN_PASSWORD, publicContact, normalizeTelegramHandle, phoneTelHref } = require("../config");

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function setCookieHeaders(res) {
  return typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
}

function cookieHeader(res) {
  return setCookieHeaders(res).map((c) => c.split(";")[0]).join("; ");
}

function publicLangCookiePair(res) {
  for (const header of setCookieHeaders(res)) {
    const pair = header.split(";")[0].trim();
    if (pair.startsWith("public.lang=")) return pair;
  }
  return null;
}

function assertPublicHtmlSafe(html) {
  assert.doesNotMatch(html, /href=["']\/admin/i);
  assert.doesNotMatch(html, /href=["']\/login/i);
  assert.doesNotMatch(html, /admin\.sid/i);
  assert.doesNotMatch(html, /ADMIN_PASSWORD/);
  assert.doesNotMatch(html, /SESSION_SECRET/);
  assert.doesNotMatch(html, /ADMIN_USERNAME/);
  assert.doesNotMatch(html, /\bREGISTER\b/);
  assert.doesNotMatch(html, /\bSEND_SMS\b/);
  assert.doesNotMatch(html, /\bdeviceId\b/);
  assert.doesNotMatch(html, /\/ws\b/);
  assert.doesNotMatch(html, /`API_KEY`/);
  assert.doesNotMatch(html, /API_KEY=/);
  assert.doesNotMatch(html, /otp_[0-9a-fA-F]{64,}/);
}

function assertDocsProtocolTokens(html) {
  assert.match(html, /POST/);
  assert.match(html, /\/api\/send-otp/);
  assert.match(html, /x-api-key/i);
  assert.match(html, /queued/);
  assert.match(html, /Unauthorized/);
  assert.match(html, /quota exceeded/);
  assert.match(html, /too many requests/);
  assert.match(html, /queue full/);
  assert.match(html, /otp_YOUR_API_KEY/);
  assert.match(html, /curl -sS -X POST/);
}

describe("public site", () => {
  let server;
  let base;

  before(async () => {
    openDb(":memory:");
    const app = createApp();
    const listening = await listen(app);
    server = listening.server;
    base = listening.base;
  });

  after(() => {
    return new Promise((resolve, reject) => {
      closeDb();
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("serves the landing at GET / as HTML", async () => {
    const res = await fetch(`${base}/`, { redirect: "manual" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");

    const html = await res.text();
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /Abat OTP/i);
    assert.match(html, /\/docs/);
    assert.match(html, /hello@abat-otp\.example/);
    assert.match(html, /id=["']contact["']|Контакты/);
    assert.match(html, /tel:\+77000000000/);
    assert.match(html, /Пн–Пт 10:00–18:00 \(UTC\+5\)/);
    assert.doesNotMatch(html, /Вы запрашиваете доступ \./);
    assert.equal(publicLangCookiePair(res), null);
    assertPublicHtmlSafe(html);
  });

  it("serves the integration guide at GET /docs", async () => {
    const res = await fetch(`${base}/docs`, { redirect: "manual" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);

    const html = await res.text();
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /POST/);
    assert.match(html, /\/api\/send-otp/);
    assert.match(html, /x-api-key/i);
    assert.match(html, /phone/);
    assert.match(html, /queued/);
    assert.match(html, /Unauthorized/);
    assert.match(html, /quota exceeded/);
    assert.match(html, /too many requests/);
    assert.match(html, /queue full/);
    assert.match(html, /tel:\+77000000000/);
    assert.doesNotMatch(html, /с оператором/);
    assertPublicHtmlSafe(html);
  });

  it("sanitizes default public contact for tel: and t.me links", () => {
    assert.equal(publicContact.email, "hello@abat-otp.example");
    assert.equal(publicContact.telegram, "abat_otp_example");
    assert.equal(publicContact.telegramUrl, "https://t.me/abat_otp_example");
    assert.equal(publicContact.phone, "+7 700 000-00-00");
    assert.equal(publicContact.phoneTel, "+77000000000");
    assert.equal(publicContact.hoursUseLocale, true);
    assert.equal(publicContact.hours, "");
    assert.equal(publicContact.hasChannels, true);
  });

  it("allowlists Telegram handles and strips phone to tel: digits", () => {
    assert.equal(normalizeTelegramHandle("abat_otp_example"), "abat_otp_example");
    assert.equal(normalizeTelegramHandle("@abat_otp_example"), "abat_otp_example");
    assert.equal(normalizeTelegramHandle("ab"), "");
    assert.equal(normalizeTelegramHandle("hello/../evil"), "");
    assert.equal(normalizeTelegramHandle("https://t.me/foo"), "");
    assert.equal(phoneTelHref("+7 700 000-00-00"), "+77000000000");
    assert.equal(phoneTelHref(""), "");
  });

  it("does not redirect GET / to /admin after admin login", async () => {
    const loginRes = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    });
    assert.equal(loginRes.status, 302);
    assert.equal(loginRes.headers.get("location"), "/admin");
    const cookie = cookieHeader(loginRes);

    const homeRes = await fetch(`${base}/`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(homeRes.status, 200);
    assert.equal(homeRes.headers.get("location"), null);
    const html = await homeRes.text();
    assert.match(html, /Abat OTP/i);
    assertPublicHtmlSafe(html);
  });

  it("still redirects unauthenticated GET /admin to /login", async () => {
    const res = await fetch(`${base}/admin`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/login");
  });

  it("still rejects POST /api/send-otp without a key", async () => {
    const res = await fetch(`${base}/api/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+77001234567" })
    });
    assert.equal(res.status, 401);
  });

  it("serves GET /?lang=en in English and sets public.lang", async () => {
    const res = await fetch(`${base}/?lang=en`, { redirect: "manual" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    assert.equal(publicLangCookiePair(res), "public.lang=en");

    const html = await res.text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /Skip to content|SMS one-time codes/);
    assert.match(html, /hello@abat-otp\.example/);
    assert.match(html, /Mon–Fri 10:00–18:00 \(UTC\+5\)/);
    assertPublicHtmlSafe(html);
  });

  it("serves GET /?lang=tk in Latin Turkmen", async () => {
    const res = await fetch(`${base}/?lang=tk`, { redirect: "manual" });
    assert.equal(res.status, 200);
    assert.equal(publicLangCookiePair(res), "public.lang=tk");

    const html = await res.text();
    assert.match(html, /<html lang="tk">/);
    assert.match(html, /Baş sahypa|Howpsuzlyk/);
    assert.match(html, /Duş–Anna 10:00–18:00 \(UTC\+5\)/);
    assert.doesNotMatch(html, /Баш сахапа|Хопсузлык/);
    assertPublicHtmlSafe(html);
  });

  it("serves GET /docs?lang=en with English chrome and English protocol tokens", async () => {
    const res = await fetch(`${base}/docs?lang=en`, { redirect: "manual" });
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /API documentation/);
    assertDocsProtocolTokens(html);
    assertPublicHtmlSafe(html);
  });

  it("keeps English protocol tokens on GET /docs?lang=tk", async () => {
    const res = await fetch(`${base}/docs?lang=tk`, { redirect: "manual" });
    assert.equal(res.status, 200);

    const html = await res.text();
    assert.match(html, /<html lang="tk">/);
    assert.match(html, /API dokumentasiýasy/);
    assertDocsProtocolTokens(html);
    assertPublicHtmlSafe(html);
  });

  it("persists public.lang from /?lang=en onto /docs without a query", async () => {
    const homeRes = await fetch(`${base}/?lang=en`, { redirect: "manual" });
    assert.equal(homeRes.status, 200);
    assert.equal(publicLangCookiePair(homeRes), "public.lang=en");
    await homeRes.text();

    const docsRes = await fetch(`${base}/docs`, {
      redirect: "manual",
      headers: { Cookie: cookieHeader(homeRes) }
    });
    assert.equal(docsRes.status, 200);
    const html = await docsRes.text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /API documentation/);
    assertDocsProtocolTokens(html);
    assertPublicHtmlSafe(html);
  });

  it("switches back to Russian with ?lang=ru and updates the cookie", async () => {
    const res = await fetch(`${base}/?lang=ru`, {
      redirect: "manual",
      headers: { Cookie: "public.lang=en" }
    });
    assert.equal(res.status, 200);
    assert.equal(publicLangCookiePair(res), "public.lang=ru");

    const html = await res.text();
    assert.match(html, /<html lang="ru">/);
    assert.match(html, /Контакты|Главная/);
    assert.match(html, /Пн–Пт 10:00–18:00 \(UTC\+5\)/);
    assertPublicHtmlSafe(html);
  });

  for (const sample of [
    { label: "fr", query: "fr" },
    { label: "empty", query: "" },
    { label: "path traversal", query: "../etc" }
  ]) {
    it(`ignores invalid lang=${sample.label} and stays Russian without setting a cookie`, async () => {
      const res = await fetch(`${base}/?lang=${encodeURIComponent(sample.query)}`, {
        redirect: "manual"
      });
      assert.equal(res.status, 200);
      assert.equal(publicLangCookiePair(res), null);
      for (const header of setCookieHeaders(res)) {
        assert.doesNotMatch(header, /public\.lang=(?!en\b|ru\b|tk\b)/);
        assert.doesNotMatch(header, /public\.lang=fr/);
        assert.doesNotMatch(header, /public\.lang=\.\./);
      }

      const html = await res.text();
      assert.match(html, /<html lang="ru">/);
      assert.match(html, /Контакты|Главная/);
      assertPublicHtmlSafe(html);
    });
  }

  it("keeps /login as English operator UI without the public language switcher", async () => {
    const res = await fetch(`${base}/login`, { redirect: "manual" });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<html lang="en">/);
    assert.match(html, /Sign in/);
    assert.match(html, /Username/);
    assert.match(html, /Password/);
    assert.doesNotMatch(html, /landing-lang/);
    assert.doesNotMatch(html, /\?lang=/);
    assert.doesNotMatch(html, /hreflang/);
  });
});
