const jwt = require("jsonwebtoken");
const User = require("../models/User");
const connectDB = require("../config/db");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // 1. Ensure DB connection before querying User model (Crucial for Vercel Serverless)
      await connectDB();

      // 2. Extract token
      token = req.headers.authorization.split(" ")[1];

      if (!token || token === "null" || token === "undefined") {
        return res
          .status(401)
          .json({ message: "Not authorized, token missing or invalid" });
      }

      // 3. Verify JWT Secret existence
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error("CRITICAL: JWT_SECRET environment variable is missing!");
        return res.status(500).json({ message: "Server configuration error" });
      }

      // 4. Verify JWT token
      const decoded = jwt.verify(token, secret);

      // 5. Extract User ID safely (supports both .id and ._id)
      const userId = decoded.id || decoded._id;

      if (!userId) {
        return res
          .status(401)
          .json({ message: "Invalid token payload structure" });
      }

      // 6. Query user without returning password field
      req.user = await User.findById(userId).select("-password");

      if (!req.user) {
        return res.status(401).json({ message: "User not found or deleted" });
      }

      return next(); // Proceed to route handler
    } catch (error) {
      console.error("Auth Middleware Error:", error.message);
      return res.status(401).json({
        message: "Not authorized, token validation failed",
        error: error.message,
      });
    }
  }

  // If no auth header present
  return res
    .status(401)
    .json({ message: "Not authorized, no Bearer token provided" });
};

module.exports = { protect };
