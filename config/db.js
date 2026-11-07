const mongoose = require("mongoose");

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error(
        "MONGO_URI or MONGODB_URI environment variable is required.",
      );
    }

    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    };

    cached.promise = mongoose.connect(mongoUri, opts).then((mongoose) => {
      console.log("MongoDB Connected Successfully");
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error("MongoDB Connection Error:", e.message);
    throw e;
  }

  return cached.conn;
};

module.exports = connectDB;
