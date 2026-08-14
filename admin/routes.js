const express = require("express");
const { listDevices } = require("../devices");

const router = express.Router();

router.get("/", (req, res) => {
  res.render("pages/admin/dashboard", {
    title: "Dashboard",
    onlineDeviceCount: listDevices().length
  });
});

module.exports = router;
