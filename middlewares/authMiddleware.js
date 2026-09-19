const jwt = require("jsonwebtoken");
const User = require("../models/User");
const connectDB = require("../config/db"); // Aapka DB connection file path

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // 1. Ensure DB connection before querying User model (Crucial for Vercel)
      await connectDB();

      // 2. Extract token
      token = req.headers.authorization.split(" ")[1];

      if (!token) {
        return res
          .status(401)
          .json({ message: "Not authorized, token missing" });
      }

      // 3. Verify JWT Secret existence
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error("CRITICAL: JWT_SECRET environment variable is missing!");
        return res.status(500).json({ message: "Server configuration error" });
      }

      const decoded = jwt.verify(token, secret);

      // 4. Extract User ID safely (supports both .id and ._id)
      const userId = decoded.id || decoded._id;

      if (!userId) {
        return res
          .status(401)
          .json({ message: "Invalid token payload structure" });
      }

      // 5. Query user
      req.user = await User.findById(userId).select("-password");

      if (!req.user) {
        return res.status(401).json({ message: "User not found or deleted" });
      }

      return next(); // Proceed to next controller
    } catch (error) {
      console.error("Auth Middleware Error:", error.message);
      return res.status(401).json({
        message: "Not authorized, token failed",
        error: error.message,
      });
    }
  }

  // If no auth header present
  return res.status(401).json({ message: "Not authorized, no token provided" });
};

module.exports = { protect };
