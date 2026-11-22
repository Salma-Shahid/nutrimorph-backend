const crypto = require("crypto");

const cronAuth = (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res
      .status(503)
      .json({ success: false, message: "CRON_SECRET is not configured." });
  }

  const provided = String(req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  return next();
};

module.exports = cronAuth;
