const r = JSON.parse(require("fs").readFileSync("recipes.json", "utf8"));
const cats = [
  "Post-Workout",
  "Pre-Workout",
  "High-Protein",
  "Immune Support",
  "Weight Loss",
  "Plant-Based",
  "Vegetarian",
];
const names = new Set(),
  count = {};
r.forEach((x, i) => {
  if (names.has(x.name.toLowerCase())) console.log("Duplicate name:", x.name);
  names.add(x.name.toLowerCase());
  if (!cats.includes(x.category)) console.log("Bad category:", i, x.name);
  if (x.calories < 200 || x.calories > 650)
    console.log("Calories out of range:", x.name);
  if (x.protein < 10 || x.protein > 55)
    console.log("Protein out of range:", x.name);
  if (x.carbs < 15 || x.carbs > 75) console.log("Carbs out of range:", x.name);
  if (x.fats < 5 || x.fats > 30) console.log("Fats out of range:", x.name);
  count[x.category] = (count[x.category] || 0) + 1;
});
console.log("Total:", r.length, count);
