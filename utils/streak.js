const formatUtcDate = (date) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const getDayNumber = (date) => {
  const normalized = formatUtcDate(date);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
};

const updateStreak = (lastLoggedDate, currentStreak, activityDate) => {
  const today = activityDate || new Date().toISOString().slice(0, 10);
  const lastDay = lastLoggedDate ? getDayNumber(lastLoggedDate) : null;
  const activityDay = getDayNumber(today);

  if (activityDay === null) {
    throw new Error("A valid YYYY-MM-DD activity date is required.");
  }
  if (lastDay === null) {
    return { streak: 1, lastLoggedDate: today };
  }
  if (activityDay <= lastDay) {
    return { streak: Math.max(1, Number(currentStreak) || 1), lastLoggedDate };
  }
  return {
    streak: activityDay - lastDay === 1 ? (Number(currentStreak) || 0) + 1 : 1,
    lastLoggedDate: today,
  };
};

module.exports = { updateStreak };
