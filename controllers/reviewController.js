const gplay = require("google-play-scraper");
const Review = require("../models/Review"); // Aapka MongoDB Review Model

const fetchAndSavePlayStoreReviews = async (req) => {
  try {
    const reviewsData = await gplay.reviews({
      appId: "com.nutrimorph.app", // Aapki app ka Play Store package name
      sort: gplay.sort.NEWEST,
      num: 20,
    });

    for (const item of reviewsData.data) {
      await Review.findOneAndUpdate(
        { reviewId: item.id },
        {
          author: item.userName,
          comment: item.text,
          rating: item.score,
          updatedAt: new Date(),
        },
        { upsert: true, new: true },
      );
    }

    console.log("Play Store reviews synced successfully!");
  } catch (error) {
    console.error("Error fetching reviews:", error);
  }
};

module.exports = { fetchAndSavePlayStoreReviews };
