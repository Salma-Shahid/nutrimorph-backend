const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error(
        "MONGO_URI / MONGODB_URI environment variable missing hai!",
      );
    }

    const db = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000, // 5 seconds fast timeout
    });

    isConnected = db.connections[0].readyState === 1;
    console.log("MongoDB Connected Successfully");
  } catch (error) {
    console.error("MongoDB Connection Error:", error.message);
    throw error;
  }
};

module.exports = connectDB;
