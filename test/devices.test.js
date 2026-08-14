const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const {
  registerDevice,
  unregisterDevice,
  getAvailableDevice,
  incrementCounter,
  listDevices
} = require("../devices");

function mockWs(readyState = WebSocket.OPEN) {
  return {
    readyState,
    closed: false,
    close() {
      this.closed = true;
      this.readyState = WebSocket.CLOSED;
    }
  };
}

describe("devices", () => {
  const ids = [];

  beforeEach(() => {
    // Unregister any leftover devices from prior tests
    for (const { id, ws } of ids.splice(0)) {
      unregisterDevice(id, ws);
    }
  });

  function track(id, ws) {
    ids.push({ id, ws });
    return ws;
  }

  it("reconnect preserves sentCount and replaces ws", () => {
    const ws1 = track("dev-a", mockWs());
    registerDevice("dev-a", ws1);
    incrementCounter("dev-a");
    incrementCounter("dev-a");

    const ws2 = track("dev-a", mockWs());
    registerDevice("dev-a", ws2);

    assert.equal(ws1.closed, true);

    const available = getAvailableDevice(500);
    assert.ok(available);
    assert.equal(available.id, "dev-a");
    assert.equal(available.device.ws, ws2);
    assert.equal(available.device.sentCount, 2);
    assert.equal(available.device.online, true);
  });

  it("unregister with stale ws is a no-op", () => {
    const ws1 = track("dev-b", mockWs());
    registerDevice("dev-b", ws1);

    const ws2 = track("dev-b", mockWs());
    registerDevice("dev-b", ws2);

    assert.equal(unregisterDevice("dev-b", ws1), false);

    const stillThere = getAvailableDevice(500);
    assert.ok(stillThere);
    assert.equal(stillThere.id, "dev-b");
    assert.equal(stillThere.device.ws, ws2);

    assert.equal(unregisterDevice("dev-b", ws2), true);
    assert.equal(getAvailableDevice(500), null);
  });

  it("getAvailableDevice skips offline (unregistered) devices", () => {
    const ws = track("dev-c", mockWs());
    registerDevice("dev-c", ws);
    assert.ok(getAvailableDevice(500));

    assert.equal(unregisterDevice("dev-c", ws), true);
    assert.equal(getAvailableDevice(500), null);
  });

  it("getAvailableDevice skips devices over MAX_SMS limit", () => {
    const ws = track("dev-d", mockWs());
    registerDevice("dev-d", ws);
    incrementCounter("dev-d");
    incrementCounter("dev-d");

    assert.equal(getAvailableDevice(2), null);
    assert.ok(getAvailableDevice(3));
  });

  it("getAvailableDevice skips non-OPEN sockets", () => {
    const ws = track("dev-e", mockWs(WebSocket.CONNECTING));
    registerDevice("dev-e", ws);

    assert.equal(getAvailableDevice(500), null);

    ws.readyState = WebSocket.OPEN;
    assert.ok(getAvailableDevice(500));
  });

  it("getAvailableDevice skips offline flag when entry remains", () => {
    const ws = track("dev-f", mockWs());
    registerDevice("dev-f", ws);

    const available = getAvailableDevice(500);
    assert.ok(available);
    available.device.online = false;

    assert.equal(getAvailableDevice(500), null);
  });

  it("listDevices returns a snapshot without ws", () => {
    const ws = track("dev-list", mockWs());
    registerDevice("dev-list", ws);
    incrementCounter("dev-list");

    const listed = listDevices().find((d) => d.deviceId === "dev-list");
    assert.ok(listed);
    assert.equal(listed.deviceId, "dev-list");
    assert.equal(listed.sentCount, 1);
    assert.equal(listed.online, true);
    assert.equal(listed.readyState, WebSocket.OPEN);
    assert.equal(typeof listed.connectedAt, "number");
    assert.equal(Object.hasOwn(listed, "ws"), false);
    assert.equal(listed.ws, undefined);

    assert.equal(unregisterDevice("dev-list", ws), true);
    assert.equal(
      listDevices().some((d) => d.deviceId === "dev-list"),
      false
    );
  });

  it("listDevices reconnect preserves sentCount and still lists the device", () => {
    const ws1 = track("dev-list-re", mockWs());
    registerDevice("dev-list-re", ws1);
    incrementCounter("dev-list-re");
    incrementCounter("dev-list-re");

    const ws2 = track("dev-list-re", mockWs());
    registerDevice("dev-list-re", ws2);

    const listed = listDevices().find((d) => d.deviceId === "dev-list-re");
    assert.ok(listed);
    assert.equal(listed.sentCount, 2);
    assert.equal(listed.readyState, WebSocket.OPEN);
    assert.equal(Object.hasOwn(listed, "ws"), false);
  });
});
