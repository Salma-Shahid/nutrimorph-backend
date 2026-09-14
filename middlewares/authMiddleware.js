const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // Header se Bearer ke baad wala token alag karein
      token = req.headers.authorization.split(" ")[1];

      // Token verify karein
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Token se user ID nikal kar user fetch karein (password exclude kar ke)
      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user) {
        return res.status(401).json({ message: "User not found" });
      }

      next(); // Proceed to controller
    } catch (error) {
      console.error("Token Error:", error);
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: "Not authorized, no token provided" });
  }
};

module.exports = { protect };
