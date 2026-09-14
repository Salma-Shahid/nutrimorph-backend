const rateLimit = require("express-rate-limit");

// General API Rate Limiter
exports.apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: {
    status: "fail",
    message:
      "Too many requests from this IP. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict Limiter for AI Operations (Costly endpoints)
exports.aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 15 AI requests per window
  message: {
    status: "fail",
    message: "AI scan quota exceeded for now. Please wait 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
