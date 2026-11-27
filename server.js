const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const dotenv = require("dotenv");
dotenv.config();

const cloudinary = require("cloudinary").v2;

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const mealRoutes = require("./routes/mealRoutes");
const waterRoutes = require("./routes/waterRoutes");
const globalErrorHandler = require("./middlewares/errorHandler");
const { apiLimiter } = require("./middlewares/rateLimiter");
const chatRoutes = require("./routes/chatRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const foodRoutes = require("./routes/foodRoutes");
const savedMealsRoutes = require("./routes/savedMealsRoutes");
const mealPlanRoutes = require("./routes/mealPlanRoutes");
const initCronJobs = require("./utils/cronJobs");
const reviewRoutes = require("./routes/reviewRoutes");
const exerciseRoutes = require("./routes/exerciseRoutes");
const adminRoutes = require("./routes/adminRoutes");
const weightRoutes = require("./routes/weightRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const app = express();

// Global CORS Configuration - Updated for Expo Web & Mobile Clients
const allowedOrigins = [
  "https://nutrimorph.app",
  "https://www.nutrimorph.app",
  "http://localhost:3000",
  "http://localhost:8081",
  "http://192.168.18.113:8081",
];

// Local development clients (Expo Web on :8081/:19006, Next.js on :3000, LAN
// devices) on any port. These are only reachable from the developer's machine.
const localDevOrigin =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin) =>
  allowedOrigins.includes(origin) ||
  extraOrigins.includes(origin) ||
  localDevOrigin.test(origin) ||
  process.env.NODE_ENV !== "production";

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (native mobile apps, Postman, curl).
    if (!origin) return callback(null, true);
    // Disallowed origins get no CORS headers (the browser blocks them) rather
    // than an Error, which would turn every preflight into a 500.
    return callback(null, isAllowedOrigin(origin));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  // Standard client headers. `Cache-Control`/`Pragma` are sent by the app's
  // profile refresh and by browsers; omitting them fails the preflight.
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
    "Cache-Control",
    "Pragma",
    "Expires",
    "If-None-Match",
    "If-Modified-Since",
  ],
  exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
  credentials: true,
  maxAge: 86400,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));
// Preflights from disallowed origins end here (without CORS headers) instead
// of falling through to the database and route handlers.
app.use((req, res, next) =>
  req.method === "OPTIONS" ? res.sendStatus(204) : next(),
);

app.use("/api", async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("API request could not connect to MongoDB:", error.message);
    res.status(503).json({
      success: false,
      message: "Database is temporarily unavailable.",
    });
  }
});

// Database connection initialization
connectDB().catch((err) => {
  console.error("MongoDB connection failed on startup:", err.message);
});

// Proxy headers configuration
app.set("trust proxy", 1);

app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  paymentRoutes.handlePaddleWebhook,
);
// Registered before the per-IP API rate limiter so RevenueCat retries from
// shared infrastructure IPs are never throttled.
app.post(
  "/api/payment/revenuecat/webhook",
  express.json({ limit: "1mb" }),
  paymentRoutes.handleRevenueCatWebhook,
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Apply General Rate Limiting
app.use("/api", apiLimiter);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/water", waterRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/food", foodRoutes);
app.use("/api/saved-meals", savedMealsRoutes);
app.use("/api/meal-plans", mealPlanRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/recipes", require("./routes/recipeRoutes.js"));
app.use("/api/exercise", exerciseRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/weight", weightRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.get("/", (req, res) => {
  res.send("NutriMorph Backend Running...");
});

// Centralized Error Handler
app.use(globalErrorHandler);

// Only listen on PORT during local development (Vercel serverless handles this automatically)
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    // Start Cron Job
    initCronJobs();
  });
}

module.exports = app;
