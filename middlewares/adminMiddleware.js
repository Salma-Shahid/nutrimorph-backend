const AppError = require("../utils/appError");

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return next(new AppError("Access denied. Admin privileges required.", 403));
};

module.exports = requireAdmin;
