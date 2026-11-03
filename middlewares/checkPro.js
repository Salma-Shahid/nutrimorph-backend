const isProUser = require("../utils/isProUser");

const checkPro = (req, res, next) => {
  if (isProUser(req.user)) {
    return next();
  } else {
    return res.status(403).json({
      success: false,
      code: "PRO_REQUIRED",
      message: "This feature requires a Pro plan. Upgrade to continue.",
    });
  }
};

module.exports = { checkPro };
