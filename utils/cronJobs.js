const cron = require("node-cron");
const {
  fetchAndSavePlayStoreReviews,
} = require("../controllers/reviewController");
const purgeDeactivatedUsers = require("./purgeDeactivatedUsers");

const initCronJobs = () => {
  // Synchronize Play Store reviews daily at midnight.
  cron.schedule("0 0 * * *", async () => {
    console.log("Running scheduled task: fetching Play Store reviews.");
    await fetchAndSavePlayStoreReviews();
  });

  cron.schedule("0 * * * *", async () => {
    try {
      const count = await purgeDeactivatedUsers();
      console.log(`Purged ${count} expired deactivated account(s).`);
    } catch (error) {
      console.error("Expired account cleanup failed:", error);
    }
  });

  console.log("Scheduled cron jobs successfully.");
};

module.exports = initCronJobs;
