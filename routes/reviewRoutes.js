const express = require("express");
const router = express.Router();
const {
  fetchAndSavePlayStoreReviews,
  getReviews,
} = require("../controllers/reviewController");

// Database se reviews get karne ke liye route: GET /api/reviews
router.get("/", getReviews);

// Play Store se manually reviews sync karne ke liye route: GET /api/reviews/sync
router.get("/sync", fetchAndSavePlayStoreReviews);

module.exports = router;
