const User = require("../models/User");

const requireAdmin = async (req, res, next) => {
  try {
    const user = req.user?._id
      ? await User.findById(req.user._id).select("role")
      : null;
    if (user?.role === "admin") {
      req.user.role = user.role;
      return next();
    }
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges are required.",
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = requireAdmin;
