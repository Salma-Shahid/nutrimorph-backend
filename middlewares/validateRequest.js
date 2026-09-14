const AppError = require("../utils/appError");

const validateRequest = (schema) => async (req, res, next) => {
  try {
    await schema.parseAsync({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    return next();
  } catch (error) {
    const errorMessage = error.errors
      ? error.errors
          .map((item) => `${item.path.join(".")}: ${item.message}`)
          .join(", ")
      : "Invalid request payload";
    return next(new AppError(errorMessage, 400));
  }
};

module.exports = validateRequest;
