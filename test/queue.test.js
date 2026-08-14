const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const queue = require("../queue");

function drainQueue() {
  while (queue.hasItems()) {
    queue.getNext();
  }
}

describe("queue", () => {
  beforeEach(() => {
    drainQueue();
  });

  it("addToQueue then getNext returns FIFO order", () => {
    queue.addToQueue({ phone: "+15551111111", message: "a" });
    queue.addToQueue({ phone: "+15552222222", message: "b" });

    assert.equal(queue.size(), 2);
    assert.equal(queue.hasItems(), true);

    const first = queue.getNext();
    const second = queue.getNext();

    assert.equal(first.message, "a");
    assert.equal(first.phone, "+15551111111");
    assert.equal(first.status, "pending");
    assert.ok(first.id);
    assert.ok(first.createdAt);
    assert.ok(first.expiresAt > first.createdAt);

    assert.equal(second.message, "b");
    assert.equal(queue.size(), 0);
    assert.equal(queue.hasItems(), false);
    assert.equal(queue.getNext(), undefined);
  });

  it("isExpired is false for fresh jobs and true after expiry", () => {
    queue.addToQueue({ phone: "+15553333333", message: "fresh" });
    const job = queue.getNext();

    assert.equal(queue.isExpired(job), false);

    job.expiresAt = Date.now() - 1;
    assert.equal(queue.isExpired(job), true);
  });

  it("cleanupExpired removes expired jobs and keeps valid ones", () => {
    queue.addToQueue({ phone: "+15554444444", message: "keep" });
    queue.addToQueue({ phone: "+15555555555", message: "drop" });

    const keep = queue.getNext();
    const drop = queue.getNext();
    drop.expiresAt = Date.now() - 1;

    queue.requeue(drop);
    queue.requeue(keep);

    assert.equal(queue.size(), 2);
    queue.cleanupExpired();

    assert.equal(queue.size(), 1);
    assert.equal(drop.status, "expired");

    const remaining = queue.getNext();
    assert.equal(remaining.message, "keep");
    assert.equal(remaining.status, "pending");
  });

  it("requeue puts job at the front", () => {
    queue.addToQueue({ phone: "+15556666666", message: "first" });
    queue.addToQueue({ phone: "+15557777777", message: "second" });

    const first = queue.getNext();
    queue.requeue(first);

    assert.equal(queue.getNext().message, "first");
    assert.equal(queue.getNext().message, "second");
  });

  it("size tracks queue length", () => {
    assert.equal(queue.size(), 0);
    queue.addToQueue({ phone: "+15558888888", message: "one" });
    assert.equal(queue.size(), 1);
    queue.addToQueue({ phone: "+15559999999", message: "two" });
    assert.equal(queue.size(), 2);
    queue.getNext();
    assert.equal(queue.size(), 1);
  });
});
