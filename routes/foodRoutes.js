const express = require("express");
const router = express.Router();
const { searchFood, lookupBarcode } = require("../controllers/foodController");
const { protect } = require("../middlewares/authMiddleware");

router.get("/search", protect, searchFood);
router.get("/barcode/:code", protect, lookupBarcode);

module.exports = router;
