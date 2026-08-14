require("dotenv").config();
const http = require("http");
const { PORT, HOST, getLanIPv4, assertAdminConfig } = require("./config");
const { getDb } = require("./db");
const { createApp } = require("./app");
const startWsServer = require("./ws");

assertAdminConfig();
getDb();
const app = createApp();
const server = http.createServer(app);
startWsServer(server);

server.listen(PORT, HOST, () => {
  console.log(`SMS Gateway listening on http://${HOST}:${PORT}`);
  const lanIp = getLanIPv4();
  if (lanIp) {
    console.log(`http://${lanIp}:${PORT}`);
    console.log(`WebSocket ws://${lanIp}:${PORT}/ws`);
  } else {
    console.warn("No private IPv4 found; set sms_relay wsUrl by hand");
  }
});
