const AppError = require("../utils/appError");

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // Mongoose Validation Error Fix
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
    err = new AppError(message, 400);
  }

  // Mongoose Bad ObjectId / CastError Fix
  if (err.name === "CastError") {
    err = new AppError(`Invalid ${err.path}: ${err.value}`, 400);
  }

  const response = {
    success: false,
    status: err.status,
    message: err.message,
  };

  if (process.env.NODE_ENV === "development") {
    console.error("💥 Backend Error Detail:", err);
    return res.status(err.statusCode).json({
      ...response,
      error: err,
      stack: err.stack,
    });
  }

  if (err.isOperational) {
    return res.status(err.statusCode).json(response);
  }

  console.error("ERROR 💥:", err);
  return res.status(500).json({
    success: false,
    status: "error",
    message: "Internal server error. Please try again later.",
  });
};

module.exports = globalErrorHandler;
