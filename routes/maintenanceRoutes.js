const express = require("express");
const router = express.Router();
const cronAuth = require("../middlewares/cronAuth");
const purgeDeactivatedUsers = require("../utils/purgeDeactivatedUsers");

router.get("/purge-deactivated", cronAuth, async (req, res) => {
  try {
    const purgedUsers = await purgeDeactivatedUsers();
    return res.json({ success: true, purgedUsers });
  } catch (error) {
    console.error("Could not purge expired deactivated accounts:", error);
    return res.status(500).json({
      success: false,
      message: "Account cleanup failed.",
    });
  }
});

module.exports = router;
