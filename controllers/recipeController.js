const SavedMeal = require("../models/SavedMeal");
const Meal = require("../models/Meal");
const User = require("../models/User");
const { updateStreak } = require("../utils/streak");

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

// Labels users pick → stored cuisine values they should match.
const CUISINE_ALIASES = {
  arabic: ["arabic", "middle eastern", "lebanese", "arab"],
  "middle eastern": ["middle eastern", "arabic", "lebanese", "arab"],
  asian: ["asian", "asian fusion", "chinese", "thai", "japanese"],
  desi: ["pakistani", "indian", "desi"],
  pakistani: ["pakistani", "desi"],
  indian: ["indian", "desi"],
};

const titleCase = (value) =>
  value.replace(/\b\w/g, (char) => char.toUpperCase());

const toList = (value) =>
  String(value || "")
    .split(",")
    .map(normalize)
    .filter((entry) => entry && entry !== "all");

const recipeTags = (recipe) =>
  [recipe.category, ...(Array.isArray(recipe.tags) ? recipe.tags : [])]
    .map(normalize)
    .filter(Boolean);

const matchesCuisine = (recipe, selected) => {
  if (!selected.length) return true;
  const cuisine = normalize(recipe.cuisine);
  return selected.some((choice) =>
    (CUISINE_ALIASES[choice] || [choice]).includes(cuisine),
  );
};

const matchesCategory = (recipe, selected) => {
  if (!selected.length) return true;
  const tags = recipeTags(recipe);
  return selected.some((choice) => tags.includes(choice));
};

const countFacet = (recipes, read) => {
  const counts = new Map();
  recipes.forEach((recipe) => {
    const seen = new Set();
    [].concat(read(recipe)).forEach((raw) => {
      const key = normalize(raw);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const entry = counts.get(key) || {
        value: key,
        // Keep the stored spelling (e.g. "High-Protein") for display.
        label: String(raw).trim() || titleCase(key),
        count: 0,
      };
      entry.count += 1;
      counts.set(key, entry);
    });
  });
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
};

// 1. Get Recipes by Category or All
// Filtering is done on normalised values (trim/lowercase/aliases) so seeded
// data like "Middle Eastern" matches the "Arabic" chip, and casing/spacing
// differences never produce an empty library. Multiple values may be sent
// comma-separated (OR within a facet, AND across facets).
const getCategorizedRecipes = async (req, res) => {
  try {
    const { category, cuisine, q } = req.query;

    // Global library only; personal saved meals stay private to their owner.
    const allRecipes = await SavedMeal.find({ isGlobal: true })
      .sort({ createdAt: -1 })
      .lean();

    const selectedCategories = toList(category);
    const selectedCuisines = toList(cuisine);
    const search = normalize(q);
    const matchesSearch = (recipe) =>
      !search ||
      normalize(recipe.name).includes(search) ||
      (Array.isArray(recipe.ingredients) &&
        recipe.ingredients.some((item) => normalize(item).includes(search)));

    const searched = allRecipes.filter(matchesSearch);
    const recipes = searched.filter(
      (recipe) =>
        matchesCategory(recipe, selectedCategories) &&
        matchesCuisine(recipe, selectedCuisines),
    );

    res.status(200).json({
      success: true,
      count: recipes.length,
      totalAvailable: allRecipes.length,
      recipes,
      data: recipes,
      // Each facet is counted against the other facet's selection so the
      // chips show how many results choosing them would produce.
      facets: {
        cuisines: countFacet(
          searched.filter((recipe) => matchesCategory(recipe, selectedCategories)),
          (recipe) => recipe.cuisine,
        ),
        categories: countFacet(
          searched.filter((recipe) => matchesCuisine(recipe, selectedCuisines)),
          (recipe) => recipe.category,
        ),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Direct "Add To Diary" Action (Recipe to Daily Meal Sync with Streak Update)
const addRecipeToDiary = async (req, res) => {
  try {
    const { recipeId, date } = req.body;
    const userId = req.user?._id || req.user?.id;

    const recipe = await SavedMeal.findOne({
      _id: recipeId,
      $or: [{ isGlobal: true }, { userId }],
    });
    if (!recipe) {
      return res
        .status(404)
        .json({ success: false, message: "Recipe not found" });
    }

    const targetDate = date || new Date().toLocaleDateString("en-CA");

    // 1. Create a new Meal entry from Recipe
    const newMeal = await Meal.create({
      userId,
      user: userId,
      email: req.user.email,
      name: recipe.name || recipe.title,
      calories: recipe.calories || 0,
      protein: recipe.protein || 0,
      carbs: recipe.carbs || 0,
      fats: recipe.fats || 0,
      servingSize: recipe.servingSize || "1 serving",
      date: targetDate,
    });

    // 2. Update Streak & Badges
    let updatedStreak = 1;
    const dbUser = await User.findById(userId);
    if (dbUser) {
      const streakResult = updateStreak(
        dbUser.lastLoggedDate,
        dbUser.streakCount,
        targetDate,
      );
      dbUser.streakCount = streakResult.streak;
      dbUser.lastLoggedDate = streakResult.lastLoggedDate;
      updatedStreak = streakResult.streak;
      await dbUser.save();
    }

    res.status(201).json({
      success: true,
      message: `${recipe.name || recipe.title} added to your Diary successfully!`,
      data: newMeal,
      streakCount: updatedStreak,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCategorizedRecipes,
  addRecipeToDiary,
};
