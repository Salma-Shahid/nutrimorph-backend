const cron = require("node-cron");
const {
  fetchAndSavePlayStoreReviews,
} = require("../controllers/reviewController");

const initCronJobs = () => {
  // Har raat 12:00 baje (00:00 AM) auto-sync chalega
  cron.schedule("0 0 * * *", async () => {
    console.log("⏰ Running Scheduled Task: Fetching Play Store Reviews...");
    await fetchAndSavePlayStoreReviews();
  });

  console.log("✅ Cron Jobs Scheduled Successfully!");
};

module.exports = initCronJobs;
