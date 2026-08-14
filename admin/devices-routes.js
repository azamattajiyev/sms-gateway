const express = require("express");
const { MAX_SMS_PER_DEVICE } = require("../config");
const { listDevices } = require("../devices");

const router = express.Router();

router.get("/", (req, res) => {
  res.render("pages/admin/devices/index", {
    title: "Devices",
    devices: listDevices(),
    maxSmsPerDevice: MAX_SMS_PER_DEVICE
  });
});

module.exports = router;
