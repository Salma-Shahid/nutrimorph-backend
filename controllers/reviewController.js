const Review = require("../models/Review"); // Aapka MongoDB Review Model

const fetchAndSavePlayStoreReviews = async (req, res) => {
  try {
    // Dynamic import for ES Modules in CommonJS
    const gplay = await import("google-play-scraper");

    const reviewsData = await gplay.default.reviews({
      appId: "com.nutrimorph.app", // Aapki app ka Play Store package name
      sort: gplay.default.sort.NEWEST,
      num: 20,
    });

    // Check if reviews are inside .data property or directly an array
    const reviews = reviewsData.data || reviewsData;

    for (const item of reviews) {
      await Review.findOneAndUpdate(
        { reviewId: item.id },
        {
          reviewId: item.id,
          author: item.userName,
          comment: item.text,
          rating: item.score,
          updatedAt: new Date(),
        },
        { upsert: true, new: true },
      );
    }

    console.log("Play Store reviews synced successfully!");
    if (res) {
      return res
        .status(200)
        .json({ success: true, message: "Reviews synced successfully!" });
    }
  } catch (error) {
    console.error("Error fetching reviews:", error);
    if (res) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
};

// 2. Database se Reviews Fetch Karne Ka Function
const getReviews = async (req, res) => {
  try {
    const reviews = await Review.find().sort({ updatedAt: -1 });
    res.status(200).json({ success: true, data: reviews });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  fetchAndSavePlayStoreReviews,
  getReviews,
};
