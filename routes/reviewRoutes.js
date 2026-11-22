const express = require("express");
const router = express.Router();
const {
  fetchAndSavePlayStoreReviews,
  getReviews,
} = require("../controllers/reviewController");
const cronAuth = require("../middlewares/cronAuth");

// Get reviews from the database: GET /api/reviews.
router.get("/", getReviews);

// Manually sync reviews from the Play Store: GET /api/reviews/sync.
router.get("/sync", cronAuth, fetchAndSavePlayStoreReviews);

module.exports = router;
