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

  function heartbeat() {
    this.isAlive = true;
  }

  wss.on("connection", (ws) => {
    let deviceId = null;

    ws.isAlive = true;

    ws.on("pong", heartbeat);

    ws.on("message", (data) => {
      let msg;

      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "REGISTER":
          deviceId = msg.deviceId;
          ws.deviceId = deviceId;

          registerDevice(deviceId, ws);

          console.log("📱 Device connected:", deviceId);

          ws.send(JSON.stringify({ type: "REGISTERED" }));
          break;

        case "PONG":
          ws.isAlive = true;
          break;

        case "SMS_SENT":
          incrementCounter(deviceId);
          console.log("✅ SMS sent by", deviceId);
          break;

        case "SMS_FAILED":
          console.log("❌ SMS failed:", msg.reason);
          break;
      }
    });

    ws.on("close", () => {
      if (deviceId) {
        unregisterDevice(deviceId);
        console.log("📴 Device disconnected:", deviceId);
      }
    });
  });

  // =============================
  // 🔥 HEARTBEAT LOOP
  // =============================
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log("💀 Kill dead:", ws.deviceId);
        return ws.terminate();
      }

      ws.isAlive = false;

      try {
        ws.ping(); // TCP keepalive
        ws.send(JSON.stringify({ type: "PING" })); // Flutter fallback
      } catch (e) {}
    });
  }, 25000);

  wss.on("close", () => clearInterval(interval));

  // =============================
  // QUEUE PROCESSING
  // =============================
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