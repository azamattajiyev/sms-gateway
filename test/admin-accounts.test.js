const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { openDb, closeDb } = require("../db");
const { createApp } = require("../app");
const accounts = require("../accounts");
const { ADMIN_USERNAME, ADMIN_PASSWORD } = require("../config");

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function cookieHeader(res, previous = "") {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (!raw.length) return previous;
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function login(base) {
  const res = await fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
  });
  assert.equal(res.status, 302);
  return cookieHeader(res);
}

function formHeaders(cookie) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

describe("admin accounts CRUD", () => {
  let server;
  let base;
  let cookie;

  before(async () => {
    openDb(":memory:");
    const app = createApp();
    const listening = await listen(app);
    server = listening.server;
    base = listening.base;
    cookie = await login(base);
  });

  after(() => {
    return new Promise((resolve, reject) => {
      closeDb();
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("redirects unauthenticated account URLs to /login", async () => {
    const paths = [
      ["GET", "/admin/accounts"],
      ["GET", "/admin/accounts/new"],
      ["POST", "/admin/accounts"],
      ["GET", "/admin/accounts/1/created"],
      ["GET", "/admin/accounts/1/edit"],
      ["POST", "/admin/accounts/1"],
      ["POST", "/admin/accounts/1/topup"],
      ["POST", "/admin/accounts/1/regenerate-key"],
      ["POST", "/admin/accounts/1/disable"]
    ];

    for (const [method, path] of paths) {
      const res = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined
      });
      assert.equal(res.status, 302, `${method} ${path}`);
      assert.equal(res.headers.get("location"), "/login", `${method} ${path}`);
    }
  });

  it("creates an account, shows the API key once, and lists prefix only", async () => {
    const createRes = await fetch(`${base}/admin/accounts`, {
      method: "POST",
      redirect: "manual",
      headers: formHeaders(cookie),
      body: new URLSearchParams({
        name: "Abat",
        brandName: "Abat",
        otpLength: "6",
        smsQuota: "5"
      })
    });

    assert.equal(createRes.status, 302);
    const createdPath = createRes.headers.get("location");
    assert.match(createdPath, /^\/admin\/accounts\/\d+\/created$/);
    cookie = cookieHeader(createRes, cookie);

    const keyRes = await fetch(`${base}${createdPath}`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(keyRes.status, 200);
    const keyHtml = await keyRes.text();
    const keyMatch = keyHtml.match(/otp_[0-9a-f]{64}/);
    assert.ok(keyMatch, "created page should show the raw API key");
    assert.match(keyHtml, /Copy now; it will not be shown again/);
    const apiKey = keyMatch[0];
    cookie = cookieHeader(keyRes, cookie);

    const againRes = await fetch(`${base}${createdPath}`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(againRes.status, 302);
    cookie = cookieHeader(againRes, cookie);

    const listed = accounts.list();
    const created = listed.find((a) => a.name === "Abat");
    assert.ok(created);
    assert.equal(created.smsQuota, 5);
    assert.equal(created.otpLength, 6);
    assert.equal(created.brandName, "Abat");
    assert.equal(created.enabled, true);
    assert.equal(created.apiKey, undefined);
    assert.equal(accounts.findByApiKey(apiKey).id, created.id);

    const listRes = await fetch(`${base}/admin/accounts`, {
      headers: { Cookie: cookie }
    });
    assert.equal(listRes.status, 200);
    const listHtml = await listRes.text();
    assert.match(listHtml, new RegExp(created.apiKeyPrefix));
    assert.equal(listHtml.includes(apiKey), false);
    assert.match(listHtml, />5</);
    assert.match(listHtml, />6</);
    assert.match(listHtml, /Enabled/);
  });

  it("re-renders create on validation failure", async () => {
    const res = await fetch(`${base}/admin/accounts`, {
      method: "POST",
      redirect: "manual",
      headers: formHeaders(cookie),
      body: new URLSearchParams({
        name: "",
        brandName: "Brand",
        otpLength: "6",
        smsQuota: "1"
      })
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /must be/);
    assert.match(html, /name="brandName"[^>]*value="Brand"/);
  });

  it("updates fields, tops up quota, regenerates the key, and disables", async () => {
    const seed = accounts.create({
      name: "Seed",
      brandName: "OldBrand",
      otpLength: 4,
      smsQuota: 5
    });
    const oldKey = seed.apiKey;

    const updateRes = await fetch(`${base}/admin/accounts/${seed.id}`, {
      method: "POST",
      redirect: "manual",
      headers: formHeaders(cookie),
      body: new URLSearchParams({
        name: "Seed Updated",
        brandName: "NewBrand",
        otpLength: "8",
        enabled: "on"
      })
    });
    assert.equal(updateRes.status, 302);
    cookie = cookieHeader(updateRes, cookie);
    const afterUpdate = accounts.getById(seed.id);
    assert.equal(afterUpdate.name, "Seed Updated");
    assert.equal(afterUpdate.brandName, "NewBrand");
    assert.equal(afterUpdate.otpLength, 8);
    assert.equal(afterUpdate.enabled, true);

    const topupRes = await fetch(`${base}/admin/accounts/${seed.id}/topup`, {
      method: "POST",
      redirect: "manual",
      headers: formHeaders(cookie),
      body: new URLSearchParams({ amount: "10" })
    });
    assert.equal(topupRes.status, 302);
    cookie = cookieHeader(topupRes, cookie);
    assert.equal(accounts.getById(seed.id).smsQuota, 15);

    const regenRes = await fetch(`${base}/admin/accounts/${seed.id}/regenerate-key`, {
      method: "POST",
      redirect: "manual",
      headers: formHeaders(cookie)
    });
    assert.equal(regenRes.status, 302);
    assert.match(regenRes.headers.get("location"), new RegExp(`/admin/accounts/${seed.id}/created`));
    cookie = cookieHeader(regenRes, cookie);
    assert.equal(accounts.findByApiKey(oldKey), null);

    const newKeyRes = await fetch(`${base}${regenRes.headers.get("location")}`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(newKeyRes.status, 200);
    const newKeyHtml = await newKeyRes.text();
    const newKeyMatch = newKeyHtml.match(/otp_[0-9a-f]{64}/);
    assert.ok(newKeyMatch);
    assert.notEqual(newKeyMatch[0], oldKey);
    assert.equal(accounts.findByApiKey(newKeyMatch[0]).id, seed.id);
    cookie = cookieHeader(newKeyRes, cookie);

    const disableRes = await fetch(`${base}/admin/accounts/${seed.id}/disable`, {
      method: "POST",
      redirect: "manual",
      headers: formHeaders(cookie)
    });
    assert.equal(disableRes.status, 302);
    assert.equal(accounts.getById(seed.id).enabled, false);
  });

  it("redirects invalid account ids to the list", async () => {
    const res = await fetch(`${base}/admin/accounts/99999/edit`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/admin/accounts");
  });
});
