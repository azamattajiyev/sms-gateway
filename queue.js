const crypto = require("crypto");

let queue = [];

function isExpired(job) {
  return job.expiresAt < Date.now();
}

function size() {
  return queue.length;
}

function addToQueue(data) {
  const now = Date.now();
  queue.push({
    ...data,
    id: data.id || crypto.randomUUID(),
    createdAt: now,
    expiresAt: now + 60000,
    status: "pending"
  });
}

function getNext() {
  return queue.shift();
}

function requeue(job) {
  queue.unshift(job);
}

function hasItems() {
  return queue.length > 0;
}

function cleanupExpired() {
  queue = queue.filter(job => {
    if (isExpired(job)) {
      job.status = "expired";
      return false; // remove from queue
    }
    return true;
  });
}

// Background cleanup every 30 seconds (unref so tests/process can exit)
const cleanupTimer = setInterval(cleanupExpired, 30000);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

module.exports = {
  addToQueue,
  getNext,
  requeue,
  hasItems,
  isExpired,
  cleanupExpired,
  size
};
