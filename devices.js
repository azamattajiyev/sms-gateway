const WebSocket = require("ws");

const devices = new Map();
// deviceId => { ws, sentCount, online, connectedAt }

function registerDevice(deviceId, ws) {
  const existing = devices.get(deviceId);
  const sentCount = existing?.sentCount ?? 0;
  const oldWs = existing?.ws && existing.ws !== ws ? existing.ws : null;

  // Set Map first so the device is never briefly missing during replace.
  // Refresh connectedAt on every successful REGISTER so "connected since"
  // matches the current socket; sentCount is preserved across reconnects.
  devices.set(deviceId, {
    ws,
    sentCount,
    online: true,
    connectedAt: Date.now()
  });

  if (oldWs) {
    try {
      oldWs.close();
    } catch (_) {
      // ignore close errors on stale socket
    }
  }
}

function unregisterDevice(deviceId, ws) {
  const entry = devices.get(deviceId);
  if (!entry) return false;
  // Only clear if this closing socket is still the registered one
  if (entry.ws !== ws) return false;
  devices.delete(deviceId);
  return true;
}

function getAvailableDevice(maxSms) {
  for (const [id, device] of devices.entries()) {
    if (
      device.online &&
      device.sentCount < maxSms &&
      device.ws?.readyState === WebSocket.OPEN
    ) {
      return { id, device };
    }
  }
  return null;
}

function incrementCounter(deviceId) {
  if (devices.has(deviceId)) {
    devices.get(deviceId).sentCount++;
  }
}

function listDevices() {
  const out = [];
  for (const [id, device] of devices.entries()) {
    out.push({
      deviceId: id,
      sentCount: device.sentCount,
      online: Boolean(device.online),
      readyState: device.ws?.readyState ?? null,
      connectedAt: device.connectedAt ?? null
    });
  }
  return out;
}

module.exports = {
  registerDevice,
  unregisterDevice,
  getAvailableDevice,
  incrementCounter,
  listDevices
};
