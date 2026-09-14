const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const dotenv = require("dotenv");
dotenv.config(); // 👈 Sabse pehle env variables load hona lazmi hain!

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
connectDB();

const app = express();
// 🟢 DevTunnel / Proxy headers ko allow karne ke liye
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Har incoming request ko terminal par print karne ke liye:
app.use((req, res, next) => {
  console.log(`📩 Incoming Request: ${req.method} ${req.url}`);
  next();
});

// Apply General Rate Limiting to all routes
app.use("/api", apiLimiter);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/water", waterRoutes);
// Endpoints list mein add karein:
app.use("/api/chat", chatRoutes);
app.use("/api/payment", paymentRoutes);

app.get("/", (req, res) => {
  res.send("NutriMorph Backend Running...");
});

// Centralized Error Middleware (Must be last)
app.use(globalErrorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
