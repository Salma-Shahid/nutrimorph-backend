const express = require("express");
const router = express.Router();


const checkPro = (req, res, next) => {
  if (req.user && req.user.subscriptionTier === "pro") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Yeh feature sirf Pro Users ke liye hai! Upgrade karein.",
    });
  }
};

module.exports = { checkPro };
