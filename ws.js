const WebSocket = require("ws");
const {
  registerDevice,
  unregisterDevice,
  getAvailableDevice,
  incrementCounter
} = require("./devices");
const queue = require("./queue");
const { MAX_SMS_PER_DEVICE } = require("./config");

function startWsServer(server) {
  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws) => {
    let deviceId = null;

    ws.on("message", (data) => {
      const msg = JSON.parse(data);

      if (msg.type === "REGISTER") {
        deviceId = msg.deviceId;
        registerDevice(deviceId, ws);
        console.log("📱 Device connected:", deviceId);
        ws.send(JSON.stringify({ "type": "REGISTERED" }));
      }

      if (msg.type === "SMS_SENT") {
        incrementCounter(deviceId);
        console.log("✅ SMS sent by", deviceId);
      }

      if (msg.type === "SMS_FAILED") {
        console.log("❌ SMS failed:", msg.reason);
      }
    });

    ws.on("close", () => {
      if (deviceId) {
        unregisterDevice(deviceId);
        console.log("📴 Device disconnected:", deviceId);
      }
    });
  });

  // очередь обработки
  setInterval(() => {
    if (!queue.hasItems()) return;

    const deviceData = getAvailableDevice(MAX_SMS_PER_DEVICE);
    if (!deviceData) return;

    const job = queue.getNext();

    if (deviceData.device.ws.readyState === WebSocket.OPEN) {
      deviceData.device.ws.send(
        JSON.stringify({
          type: "SEND_SMS",
          payload: job
        })
      );
    }
  }, 1000);
}

module.exports = startWsServer;