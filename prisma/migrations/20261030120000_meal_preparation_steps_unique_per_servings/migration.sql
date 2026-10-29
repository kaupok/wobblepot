-- HON-1379: one steps row per meal, locale and serving count, so a library
-- meal stays cached at every household size. Widening the key cannot fail on
-- existing rows: they are already unique on (mealId, locale).

-- DropIndex
DROP INDEX "meal_preparation_steps_mealId_locale_key";

-- CreateIndex
CREATE UNIQUE INDEX "meal_preparation_steps_mealId_locale_servings_key" ON "meal_preparation_steps"("mealId", "locale", "servings");
