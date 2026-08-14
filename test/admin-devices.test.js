const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const WebSocket = require("ws");
const { openDb, closeDb } = require("../db");
const { createApp } = require("../app");
const { registerDevice, unregisterDevice } = require("../devices");
const { ADMIN_USERNAME, ADMIN_PASSWORD, MAX_SMS_PER_DEVICE } = require("../config");

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

function mockWs(readyState = WebSocket.OPEN) {
  return {
    readyState,
    close() {
      this.readyState = WebSocket.CLOSED;
    }
  };
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

describe("admin devices", () => {
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

  it("redirects unauthenticated /admin/devices to /login", async () => {
    const res = await fetch(`${base}/admin/devices`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/login");
  });

  it("lists registered devices for a logged-in admin", async () => {
    const ws = mockWs();
    registerDevice("admin-dev-1", ws);
    try {
      const res = await fetch(`${base}/admin/devices`, {
        redirect: "manual",
        headers: { Cookie: cookie }
      });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /admin-dev-1/);
      assert.match(html, /Online/);
      assert.match(html, new RegExp(`0 / ${MAX_SMS_PER_DEVICE}`));
      assert.doesNotMatch(html, /\b\[object WebSocket\]\b/);
    } finally {
      unregisterDevice("admin-dev-1", ws);
    }
  });

  it("drops a device from the page after unregister", async () => {
    const ws = mockWs();
    registerDevice("admin-dev-gone", ws);
    unregisterDevice("admin-dev-gone", ws);

    const res = await fetch(`${base}/admin/devices`, {
      redirect: "manual",
      headers: { Cookie: cookie }
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.doesNotMatch(html, /admin-dev-gone/);
    assert.match(html, /No devices online/);
  });
});
