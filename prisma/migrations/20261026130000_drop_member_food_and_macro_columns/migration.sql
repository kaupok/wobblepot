-- HON-1324: drop the member food and macro columns. HON-1322 removed every
-- read and write; production held no value in any of them (owner-approved).
ALTER TABLE "member_preferences"
  DROP COLUMN "targetCalories",
  DROP COLUMN "targetProtein",
  DROP COLUMN "targetCarbs",
  DROP COLUMN "targetFat",
  DROP COLUMN "dietaryType",
  DROP COLUMN "allergens",
  DROP COLUMN "restrictions",
  DROP COLUMN "excludedIngredients",
  DROP COLUMN "excludedIngredientIds";
