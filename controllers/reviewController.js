const Review = require("../models/Review"); // MongoDB review model.

const syncPlayStoreReviews = async () => {
  const gplay = await import("google-play-scraper");
  const reviewsData = await gplay.default.reviews({
    appId: process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.nutrimorph.app",
    sort: gplay.default.sort.NEWEST,
    num: 100,
  });
  const reviews = reviewsData.data || reviewsData;

  for (const item of reviews) {
    if (!item.id) continue;
    await Review.findOneAndUpdate(
      { reviewId: item.id },
      {
        $set: {
          author: item.userName,
          comment: item.text,
          rating: item.score,
          updatedAt: new Date(),
        },
        $setOnInsert: { reviewId: item.id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  return reviews.length;
};

const fetchAndSavePlayStoreReviews = async (req, res) => {
  try {
    const syncedCount = await syncPlayStoreReviews();
    console.log(`Synced ${syncedCount} Play Store reviews.`);
    if (res) {
      return res.status(200).json({
        success: true,
        syncedCount,
        message: "Reviews synced successfully.",
      });
    }
    return syncedCount;
  } catch (error) {
    console.error("Error fetching reviews:", error);
    if (res) {
      return res
        .status(500)
        .json({ success: false, message: "Could not sync Play Store reviews." });
    }
    throw error;
  }
};

// Fetch reviews from the database.
const getReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ isHidden: { $ne: true } })
      .sort({ updatedAt: -1 })
      .limit(100);
    res.status(200).json({ success: true, data: reviews });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  fetchAndSavePlayStoreReviews,
  getReviews,
};
