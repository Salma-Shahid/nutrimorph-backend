const express = require("express");
const router = express.Router();


const checkPro = (req, res, next) => {
  if (req.user && req.user.subscriptionTier === "pro") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "This feature is only available to Pro users! Please upgrade.",
    });
  }
};

module.exports = { checkPro };
