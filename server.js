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
const app = express();

// Global CORS Configuration - Updated for Expo Web & Mobile Clients
const allowedOrigins = [
  "https://nutrimorph.app",
  "https://www.nutrimorph.app",
  "http://localhost:3000",
  "http://localhost:8081",
  "http://192.168.18.113:8081",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      process.env.NODE_ENV !== "production"
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/(.*)/, cors(corsOptions));

// Database connection initialization
connectDB().catch((err) => {
  console.error("MongoDB connection failed on startup:", err.message);
});

// Proxy headers configuration
app.set("trust proxy", 1);

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
