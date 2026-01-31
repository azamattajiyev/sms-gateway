const devices = new Map();
// deviceId => { ws, sentCount, online }

function registerDevice(deviceId, ws) {
  devices.set(deviceId, {
    ws,
    sentCount: 0,
    online: true
  });
}

function unregisterDevice(deviceId) {
  if (devices.has(deviceId)) {
    devices.get(deviceId).online = false;
  }
}

function getAvailableDevice(maxSms) {
  for (const [id, device] of devices.entries()) {
    if (device.online && device.sentCount < maxSms) {
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

module.exports = {
  registerDevice,
  unregisterDevice,
  getAvailableDevice,
  incrementCounter
};