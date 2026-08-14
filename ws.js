const crypto = require("crypto");
const WebSocket = require("ws");
const {
  registerDevice,
  unregisterDevice,
  getAvailableDevice,
  incrementCounter
} = require("./devices");
const queue = require("./queue");
const { API_KEY, MAX_SMS_PER_DEVICE } = require("./config");

function apiKeyMatches(provided) {
  if (typeof provided !== "string") return false;
  const expected = Buffer.from(API_KEY, "utf8");
  const actual = Buffer.from(provided, "utf8");
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Mask phone for logs: show last 4 digits only. */
function maskPhone(phone) {
  if (typeof phone !== "string" || phone.length === 0) return "(none)";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `***${digits.slice(-4)}`;
}

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
          if (!apiKeyMatches(msg.apiKey)) {
            try {
              ws.send(JSON.stringify({ type: "ERROR", error: "Unauthorized" }));
            } catch (_) {}
            ws.close();
            break;
          }

          deviceId = msg.deviceId;
          ws.deviceId = deviceId;

          registerDevice(deviceId, ws);

          console.log("Device connected:", deviceId);

          queue.cleanupExpired();

          ws.send(JSON.stringify({ type: "REGISTERED" }));
          break;

        case "PONG":
          ws.isAlive = true;
          break;

        case "SMS_SENT":
          incrementCounter(deviceId);
          console.log("SMS sent by", deviceId);
          break;

        case "SMS_FAILED":
          console.log("SMS failed:", deviceId, msg.reason);
          break;
      }
    });

    ws.on("close", () => {
      if (deviceId && unregisterDevice(deviceId, ws)) {
        console.log("Device disconnected:", deviceId);
      }
    });
  });

  // Heartbeat loop
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log("Kill dead connection:", ws.deviceId);
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

  // Queue processing — only dequeue when an OPEN device is available
  setInterval(() => {
    if (!queue.hasItems()) return;

    const deviceData = getAvailableDevice(MAX_SMS_PER_DEVICE);
    if (!deviceData) return;

    // Drain expired jobs so a valid job can still send this tick
    let job = queue.getNext();
    while (job && queue.isExpired(job)) {
      job.status = "expired";
      console.log(
        "SMS job expired, skipping:",
        job.id,
        maskPhone(job.payload?.phone || job.phone)
      );
      job = queue.getNext();
    }
    if (!job) return;

    deviceData.device.ws.send(
      JSON.stringify({
        type: "SEND_SMS",
        payload: job
      }),
      (err) => {
        if (err) {
          console.log("Send failed, requeueing:", deviceData.id, job.id);
          queue.requeue(job);
        }
      }
    );
  }, 1000);
}

module.exports = startWsServer;
