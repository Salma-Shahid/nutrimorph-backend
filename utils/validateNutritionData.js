const validateNutritionData = (rawText, fallbackName) => {
  const jsonMatch = String(rawText || "").match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Nutrition analysis did not return valid JSON.");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const numberFields = ["calories", "protein", "carbs", "fats"];
  const nutrition = {};
  for (const field of numberFields) {
    const value = Number(parsed[field]);
    if (!Number.isFinite(value) || value < 0 || value > 5000) {
      throw new Error(`Nutrition analysis returned an invalid ${field} value.`);
    }
    nutrition[field] =
      field === "calories" ? Math.round(value) : Number(value.toFixed(1));
  }

  return {
    name:
      typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim().slice(0, 120)
        : String(fallbackName || "Scanned meal").trim().slice(0, 120),
    ...nutrition,
    ...(typeof parsed.servingSize === "string" && parsed.servingSize.trim()
      ? { servingSize: parsed.servingSize.trim().slice(0, 80) }
      : {}),
  };
};

module.exports = validateNutritionData;
