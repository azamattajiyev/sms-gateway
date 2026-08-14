const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { openDb, closeDb } = require("../db");
const { createApp } = require("../app");
const accounts = require("../accounts");
const queue = require("../queue");
const { API_KEY, MAX_QUEUE_SIZE } = require("../config");

function drainQueue() {
  while (queue.hasItems()) {
    queue.getNext();
  }
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function postSendOtp(base, { apiKey, body }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey !== undefined) {
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${base}/api/send-otp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe("POST /api/send-otp", () => {
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

  beforeEach(() => {
    drainQueue();
  });

  it("queues a branded OTP and returns the code", async () => {
    const account = accounts.create({
      name: "Happy",
      smsQuota: 5,
      otpLength: 6,
      brandName: "Abat"
    });

    const { status, json } = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001234567", message: "ignored client text" }
    });

    assert.equal(status, 200);
    assert.equal(json.status, "queued");
    assert.match(json.code, /^\d{6}$/);
    assert.equal(json.code.length, account.otpLength);

    const job = queue.getNext();
    assert.ok(job);
    assert.equal(job.phone, "+77001234567");
    assert.equal(job.message, `Your Abat code: ${json.code}`);
    assert.equal(job.accountId, account.id);
    assert.equal(job.status, "pending");
    assert.equal(accounts.getById(account.id).smsQuota, 4);
  });

  it("returns 400 when phone is missing or invalid", async () => {
    const account = accounts.create({
      name: "Phone",
      smsQuota: 2,
      otpLength: 4,
      brandName: "P"
    });

    const missing = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: {}
    });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.json, { error: "phone required" });

    const invalid = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "123" }
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(invalid.json, { error: "invalid phone" });

    assert.equal(queue.size(), 0);
    assert.equal(accounts.getById(account.id).smsQuota, 2);
  });

  it("returns 401 for missing, unknown, disabled, or env API_KEY", async () => {
    const account = accounts.create({
      name: "Auth",
      smsQuota: 3,
      otpLength: 4,
      brandName: "A"
    });
    accounts.update(account.id, { enabled: false });

    const cases = [
      await postSendOtp(base, { body: { phone: "+77001234567" } }),
      await postSendOtp(base, {
        apiKey: "otp_deadbeef",
        body: { phone: "+77001234567" }
      }),
      await postSendOtp(base, {
        apiKey: account.apiKey,
        body: { phone: "+77001234567" }
      }),
      await postSendOtp(base, {
        apiKey: API_KEY,
        body: { phone: "+77001234567" }
      })
    ];

    for (const result of cases) {
      assert.equal(result.status, 401);
      assert.deepEqual(result.json, { error: "Unauthorized" });
    }
    assert.equal(queue.size(), 0);
    assert.equal(accounts.getById(account.id).smsQuota, 3);
  });

  it("returns 429 without enqueue when quota is 0", async () => {
    const account = accounts.create({
      name: "Empty",
      smsQuota: 0,
      otpLength: 4,
      brandName: "E"
    });

    const { status, json } = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001234567" }
    });

    assert.equal(status, 429);
    assert.deepEqual(json, { error: "quota exceeded" });
    assert.equal(queue.size(), 0);
    assert.equal(accounts.getById(account.id).smsQuota, 0);
  });

  it("returns 503 without consuming quota when the queue is full", async () => {
    const account = accounts.create({
      name: "Full",
      smsQuota: 8,
      otpLength: 4,
      brandName: "F"
    });

    const origSize = queue.size;
    queue.size = () => MAX_QUEUE_SIZE;
    try {
      const { status, json } = await postSendOtp(base, {
        apiKey: account.apiKey,
        body: { phone: "+77001234567" }
      });
      assert.equal(status, 503);
      assert.deepEqual(json, { error: "queue full" });
    } finally {
      queue.size = origSize;
    }

    assert.equal(queue.size(), 0);
    assert.equal(accounts.getById(account.id).smsQuota, 8);
  });
});
