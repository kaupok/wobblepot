-- HON-1327: drop the member food and macro columns. HON-1324 removed the
-- fields from the Prisma schema, and production ran that build before this
-- migration, so no deployed query names these columns.
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
