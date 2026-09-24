const axios = require("axios");

/**
 * @desc    Search Food Database by Query string (OpenFoodFacts Adapter)
 * @route   GET /api/food/search?q=apple
 * @access  Private
 */
const searchFood = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: "Search query string 'q' is required.",
      });
    }

    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      q.trim(),
    )}&search_simple=1&action=process&json=1&page_size=20`;

    const response = await axios.get(url, { timeout: 8000 });
    const products = response.data?.products || [];

    const formattedFoods = products.map((item) => {
      const nutriments = item.nutriments || {};
      return {
        id: item._id || item.code,
        name: item.product_name || "Unknown Food Item",
        brand: item.brands || "Generic",
        barcode: item.code || "",
        calories: Math.round(
          nutriments["energy-kcal_100g"] || nutriments["energy-kcal"] || 0,
        ),
        protein: Math.round(
          nutriments.proteins_100g || nutriments.proteins || 0,
        ),
        carbs: Math.round(
          nutriments.carbohydrates_100g || nutriments.carbohydrates || 0,
        ),
        fats: Math.round(nutriments.fat_100g || nutriments.fat || 0),
        servingSize: item.serving_size || "100g",
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedFoods.length,
      foods: formattedFoods,
    });
  } catch (error) {
    console.error("Food Search Adapter Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch food items from database.",
    });
  }
};

/**
 * @desc    Lookup Food details by Barcode String
 * @route   GET /api/food/barcode/:code
 * @access  Private
 */
const lookupBarcode = async (req, res) => {
  try {
    const { code } = req.params;
    if (!code) {
      return res
        .status(400)
        .json({ success: false, message: "Barcode string is required." });
    }

    const url = `https://world.openfoodfacts.org/api/v2/product/${code.trim()}.json`;
    const response = await axios.get(url, { timeout: 8000 });

    if (response.data?.status === 1 && response.data?.product) {
      const item = response.data.product;
      const nutriments = item.nutriments || {};

      const foodData = {
        id: item._id || item.code,
        name: item.product_name || "Scanned Barcode Item",
        brand: item.brands || "Generic",
        barcode: item.code,
        calories: Math.round(
          nutriments["energy-kcal_100g"] || nutriments["energy-kcal"] || 0,
        ),
        protein: Math.round(nutriments.proteins_100g || 0),
        carbs: Math.round(nutriments.carbohydrates_100g || 0),
        fats: Math.round(nutriments.fat_100g || 0),
        servingSize: item.serving_size || "100g",
      };

      return res.status(200).json({ success: true, food: foodData });
    }

    return res
      .status(404)
      .json({ success: false, message: "Barcode not found in food database." });
  } catch (error) {
    console.error("Barcode Lookup Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch barcode details." });
  }
};

module.exports = {
  searchFood,
  lookupBarcode,
};
