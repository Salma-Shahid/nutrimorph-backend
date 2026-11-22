const jwt = require("jsonwebtoken");
const User = require("../models/User");
const connectDB = require("../config/db");

const protect = async (req, res, next) => {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Not authorized, no Bearer token provided" });
  }

  const token = authorization.slice("Bearer ".length);
  if (!token || token === "null" || token === "undefined") {
    return res
      .status(401)
      .json({ message: "Not authorized, token missing or invalid" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error("CRITICAL: JWT_SECRET environment variable is missing!");
    return res.status(500).json({ message: "Server configuration error" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (error) {
    return res.status(401).json({
      message: "Not authorized, token validation failed",
      error: error.message,
    });
  }

  const userId = decoded.id || decoded._id;
  if (!userId) {
    return res
      .status(401)
      .json({ message: "Invalid token payload structure" });
  }

  try {
    await connectDB();
    req.user = await User.findById(userId).select("-password");
  } catch (error) {
    console.error("Could not load authenticated user from MongoDB:", error);
    return res.status(503).json({
      message: "Account service is temporarily unavailable.",
    });
  }

  if (!req.user) {
    return res.status(401).json({ message: "User not found or deleted" });
  }
  if (req.user.deactivatedAt) {
    return res.status(403).json({
      code: "ACCOUNT_DEACTIVATED",
      message: "Sign in again to restore your deactivated account.",
    });
  }

  return next();
};

module.exports = { protect };
