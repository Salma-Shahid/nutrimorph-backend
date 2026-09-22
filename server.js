const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const dotenv = require("dotenv");
dotenv.config();

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

const app = express();

// Database connection initialization
connectDB().catch((err) => {
  console.error("MongoDB connection failed on startup:", err.message);
});

// Proxy headers configuration
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Incoming request logging
// app.use((req, res, next) => {
//   console.log(`📩 Incoming Request: ${req.method} ${req.url}`);
//   next();
// });

// Apply General Rate Limiting
app.use("/api", apiLimiter);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/water", waterRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/payment", paymentRoutes);

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
  });
}

module.exports = app;
