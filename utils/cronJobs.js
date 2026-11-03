const cron = require("node-cron");
const {
  fetchAndSavePlayStoreReviews,
} = require("../controllers/reviewController");

const initCronJobs = () => {
  // Synchronize Play Store reviews daily at midnight.
  cron.schedule("0 0 * * *", async () => {
    console.log("Running scheduled task: fetching Play Store reviews.");
    await fetchAndSavePlayStoreReviews();
  });

  console.log("Scheduled cron jobs successfully.");
};

module.exports = initCronJobs;
