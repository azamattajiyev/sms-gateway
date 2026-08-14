const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { openDb, closeDb } = require("../db");
const { createApp } = require("../app");
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

function cookieHeader(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

function hasAdminSid(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return raw.some((c) => c.startsWith("admin.sid="));
}

describe("admin auth", () => {
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

  it("redirects unauthenticated /admin to /login", async () => {
    const res = await fetch(`${base}/admin`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/login");
  });

  it("rejects a wrong password without granting a session", async () => {
    const res = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USERNAME, password: "wrong-password" })
    });

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Invalid username or password/);
    assert.equal(hasAdminSid(res), false);

    const adminRes = await fetch(`${base}/admin`, { redirect: "manual" });
    assert.equal(adminRes.status, 302);
    assert.equal(adminRes.headers.get("location"), "/login");
  });

  it("logs in, shows the dashboard, and logs out", async () => {
    const loginRes = await fetch(`${base}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    });

    assert.equal(loginRes.status, 302);
    assert.equal(loginRes.headers.get("location"), "/admin");
    assert.equal(hasAdminSid(loginRes), true);
    const cookie = cookieHeader(loginRes);

    const dashRes = await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(dashRes.status, 200);
    const dashHtml = await dashRes.text();
    assert.match(dashHtml, /Welcome/);
    assert.match(dashHtml, /Dashboard/);
    assert.match(dashHtml, /Accounts/);
    assert.match(dashHtml, /Devices/);
    assert.match(dashHtml, /Abat/);

    const logoutRes = await fetch(`${base}/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(logoutRes.status, 302);
    assert.equal(logoutRes.headers.get("location"), "/login");

    const afterRes = await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(afterRes.status, 302);
    assert.equal(afterRes.headers.get("location"), "/login");
  });

  it("does not session-gate POST /api/send-otp", async () => {
    const res = await fetch(`${base}/api/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+77001234567" })
    });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.error, "Unauthorized");
  });
});
