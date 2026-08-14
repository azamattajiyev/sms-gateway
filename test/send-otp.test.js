const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { openDb, closeDb } = require("../db");
const { createApp } = require("../app");
const accounts = require("../accounts");
const queue = require("../queue");
const rateLimit = require("../rate-limit");
const { API_KEY, MAX_QUEUE_SIZE, OTP_RATE_LIMIT_MS } = require("../config");

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
  return { status: res.status, json, headers: res.headers };
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
    rateLimit.reset();
    rateLimit.setNow(1_700_000_000_000);
  });

  afterEach(() => {
    rateLimit.reset();
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

  it("rate-limits a second send to the same phone without enqueue or quota consume", async () => {
    const account = accounts.create({
      name: "Rate",
      smsQuota: 5,
      otpLength: 4,
      brandName: "R"
    });

    const first = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110001" }
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.status, "queued");
    assert.equal(queue.size(), 1);
    assert.equal(accounts.getById(account.id).smsQuota, 4);

    const second = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110001" }
    });
    assert.equal(second.status, 429);
    assert.deepEqual(second.json, { error: "too many requests" });
    assert.notEqual(second.json.error, "quota exceeded");
    assert.equal(second.headers.get("retry-after"), String(Math.ceil(OTP_RATE_LIMIT_MS / 1000)));
    assert.equal(queue.size(), 1);
    assert.equal(accounts.getById(account.id).smsQuota, 4);
  });

  it("shares the rate limit for the same digits with and without +", async () => {
    const account = accounts.create({
      name: "Plus",
      smsQuota: 5,
      otpLength: 4,
      brandName: "P"
    });

    const first = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110002" }
    });
    assert.equal(first.status, 200);

    const second = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "77001110002" }
    });
    assert.equal(second.status, 429);
    assert.deepEqual(second.json, { error: "too many requests" });
    assert.equal(second.headers.get("retry-after"), String(Math.ceil(OTP_RATE_LIMIT_MS / 1000)));
    assert.equal(queue.size(), 1);
    assert.equal(accounts.getById(account.id).smsQuota, 4);
  });

  it("treats different phones as independent", async () => {
    const account = accounts.create({
      name: "Indep",
      smsQuota: 5,
      otpLength: 4,
      brandName: "I"
    });

    const a = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110003" }
    });
    const b = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110004" }
    });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(queue.size(), 2);
    assert.equal(accounts.getById(account.id).smsQuota, 3);
  });

  it("allows another send to the same phone after the window elapses", async () => {
    const account = accounts.create({
      name: "Window",
      smsQuota: 5,
      otpLength: 4,
      brandName: "W"
    });
    let now = 1_800_000_000_000;
    rateLimit.setNow(() => now);

    const first = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110005" }
    });
    assert.equal(first.status, 200);

    const blocked = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110005" }
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.json, { error: "too many requests" });

    now += OTP_RATE_LIMIT_MS;

    const third = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110005" }
    });
    assert.equal(third.status, 200);
    assert.equal(third.json.status, "queued");
    assert.equal(queue.size(), 2);
    assert.equal(accounts.getById(account.id).smsQuota, 3);
  });

  it("does not consume quota on a rate-limit 429", async () => {
    const account = accounts.create({
      name: "NoConsume",
      smsQuota: 3,
      otpLength: 4,
      brandName: "N"
    });

    await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110006" }
    });
    assert.equal(accounts.getById(account.id).smsQuota, 2);

    const limited = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110006" }
    });
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.json, { error: "too many requests" });
    assert.equal(accounts.getById(account.id).smsQuota, 2);
    assert.equal(queue.size(), 1);
  });

  it("returns quota exceeded 429 distinct from rate-limit when remaining SMS is 0", async () => {
    const account = accounts.create({
      name: "QuotaStill",
      smsQuota: 0,
      otpLength: 4,
      brandName: "Q"
    });

    const { status, json, headers } = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110007" }
    });

    assert.equal(status, 429);
    assert.deepEqual(json, { error: "quota exceeded" });
    assert.notEqual(json.error, "too many requests");
    assert.equal(headers.get("retry-after"), null);
    assert.equal(queue.size(), 0);
    assert.equal(accounts.getById(account.id).smsQuota, 0);
  });

  it("checks rate limit before quota consume so remaining quota is unchanged", async () => {
    const account = accounts.create({
      name: "BeforeQuota",
      smsQuota: 1,
      otpLength: 4,
      brandName: "B"
    });

    const first = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110008" }
    });
    assert.equal(first.status, 200);
    assert.equal(accounts.getById(account.id).smsQuota, 0);

    const limited = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110008" }
    });
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.json, { error: "too many requests" });
    assert.equal(accounts.getById(account.id).smsQuota, 0);
  });

  it("does not start the cooldown when the queue is full", async () => {
    const account = accounts.create({
      name: "NoCooldown",
      smsQuota: 8,
      otpLength: 4,
      brandName: "C"
    });

    const origSize = queue.size;
    queue.size = () => MAX_QUEUE_SIZE;
    try {
      const full = await postSendOtp(base, {
        apiKey: account.apiKey,
        body: { phone: "+77001110009" }
      });
      assert.equal(full.status, 503);
      assert.deepEqual(full.json, { error: "queue full" });
    } finally {
      queue.size = origSize;
    }

    const retry = await postSendOtp(base, {
      apiKey: account.apiKey,
      body: { phone: "+77001110009" }
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.json.status, "queued");
    assert.equal(queue.size(), 1);
    assert.equal(accounts.getById(account.id).smsQuota, 7);
  });

  it("applies the phone rate limit globally across accounts", async () => {
    const a = accounts.create({
      name: "AccA",
      smsQuota: 3,
      otpLength: 4,
      brandName: "A"
    });
    const b = accounts.create({
      name: "AccB",
      smsQuota: 3,
      otpLength: 4,
      brandName: "B"
    });

    const first = await postSendOtp(base, {
      apiKey: a.apiKey,
      body: { phone: "+77001110010" }
    });
    assert.equal(first.status, 200);

    const second = await postSendOtp(base, {
      apiKey: b.apiKey,
      body: { phone: "+77001110010" }
    });
    assert.equal(second.status, 429);
    assert.deepEqual(second.json, { error: "too many requests" });
    assert.equal(accounts.getById(a.id).smsQuota, 2);
    assert.equal(accounts.getById(b.id).smsQuota, 3);
  });
});
