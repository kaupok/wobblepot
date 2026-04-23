-- AlterTable: add nullable householdId to ingredient (null = global seeded pool)
-- (Household.locale was added by 20260422120000_add_household_locale during HON-501.)
ALTER TABLE "ingredient" ADD COLUMN "householdId" TEXT;

-- DropIndex: drop the global unique index on ingredient.name; replaced below by two partial unique indexes.
DROP INDEX "ingredient_name_key";

-- CreateIndex: foreign-key index for ingredient.householdId
CREATE INDEX "ingredient_householdId_idx" ON "ingredient"("householdId");

-- CreateIndex: partial unique index — name unique within a given household
CREATE UNIQUE INDEX "ingredient_household_name_key"
  ON "ingredient" ("householdId", "name")
  WHERE "householdId" IS NOT NULL;

-- CreateIndex: partial unique index — name unique across the global (seeded) pool
CREATE UNIQUE INDEX "ingredient_global_name_key"
  ON "ingredient" ("name")
  WHERE "householdId" IS NULL;

-- AddForeignKey: cascade delete household-scoped ingredients when their household is removed.
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ingredient translations
CREATE TABLE "ingredient_translation" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ingredient_translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_translation_ingredientId_locale_key" ON "ingredient_translation"("ingredientId", "locale");

-- CreateIndex
CREATE INDEX "ingredient_translation_locale_name_idx" ON "ingredient_translation"("locale", "name");

-- AddForeignKey
ALTER TABLE "ingredient_translation" ADD CONSTRAINT "ingredient_translation_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: meal translations
CREATE TABLE "meal_translation" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "preparationNotes" TEXT,

    CONSTRAINT "meal_translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_translation_mealId_locale_key" ON "meal_translation"("mealId", "locale");

-- AddForeignKey
ALTER TABLE "meal_translation" ADD CONSTRAINT "meal_translation_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
