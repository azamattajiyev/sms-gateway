const express = require("express");
const http = require("http");
const cors = require("cors");
const { PORT } = require("./config");
const { apiKeyGuard } = require("./middleware");
const queue = require("./queue");
const startWsServer = require("./ws");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/send-otp", apiKeyGuard, (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: "phone and code required" });
  }

  queue.addToQueue({
    phone,
    message
  });

  res.json({ status: "queued" });
});

const server = http.createServer(app);
startWsServer(server);

server.listen(PORT, () => {
  console.log("🚀 SMS Gateway running on port", PORT);
});