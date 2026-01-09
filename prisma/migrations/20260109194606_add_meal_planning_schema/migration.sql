-- CreateEnum
CREATE TYPE "DietaryType" AS ENUM ('omnivore', 'vegetarian', 'vegan', 'pescatarian');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('breakfast', 'lunch', 'dinner');

-- CreateEnum
CREATE TYPE "MealPlanEntryStatus" AS ENUM ('planned', 'completed', 'skipped', 'eating_out', 'leftovers');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('g', 'piece');

-- CreateEnum
CREATE TYPE "IngredientCategory" AS ENUM ('protein', 'carb', 'vegetable', 'fruit', 'dairy', 'fat', 'legume', 'condiment', 'spice');

-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('gluten', 'dairy', 'eggs', 'nuts', 'peanuts', 'soy', 'fish', 'shellfish', 'sesame');

-- CreateEnum
CREATE TYPE "ProteinType" AS ENUM ('poultry', 'beef', 'pork', 'lamb', 'fish', 'eggs', 'legume', 'dairy', 'none');

-- CreateTable
CREATE TABLE "household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Tallinn',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_member" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_invite" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_preferences" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "dietaryType" "DietaryType",
    "allergensToAvoid" "Allergen"[],
    "restrictions" TEXT[],
    "excludedIngredients" TEXT[],
    "excludedIngredientIds" TEXT[],
    "weekdayMealTypes" "MealType"[] DEFAULT ARRAY['dinner']::"MealType"[],
    "weekendMealTypes" "MealType"[] DEFAULT ARRAY['dinner']::"MealType"[],

    CONSTRAINT "household_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_preferences" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "displayName" TEXT,
    "portionMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "targetCalories" INTEGER,
    "targetProtein" INTEGER,
    "targetCarbs" INTEGER,
    "targetFat" INTEGER,
    "dietaryType" "DietaryType",
    "restrictions" TEXT[],
    "excludedIngredients" TEXT[],
    "excludedIngredientIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "IngredientCategory" NOT NULL,
    "subcategory" TEXT,
    "proteinType" "ProteinType",
    "defaultUnit" "Unit" NOT NULL,
    "allergens" "Allergen"[],
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION,
    "gramsPerPiece" DOUBLE PRECISION,
    "densityGPerMl" DOUBLE PRECISION,

    CONSTRAINT "ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "timeMinutes" INTEGER,
    "kidFriendly" BOOLEAN NOT NULL DEFAULT false,
    "primaryProteinType" "ProteinType" NOT NULL DEFAULT 'none',
    "suitableFor" "MealType"[],
    "householdId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_component" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantityPerServing" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan_entry" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "mealId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "mealType" "MealType" NOT NULL,
    "status" "MealPlanEntryStatus" NOT NULL DEFAULT 'planned',

    CONSTRAINT "meal_plan_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pantry_item" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "isStaple" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pantry_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "household_member_householdId_userId_key" ON "household_member"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "household_invite_code_key" ON "household_invite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "household_preferences_householdId_key" ON "household_preferences"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "member_preferences_memberId_key" ON "member_preferences"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_name_key" ON "ingredient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "meal_component_mealId_ingredientId_key" ON "meal_component"("mealId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_householdId_startDate_key" ON "meal_plan"("householdId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_entry_planId_date_mealType_key" ON "meal_plan_entry"("planId", "date", "mealType");

-- CreateIndex
CREATE UNIQUE INDEX "pantry_item_householdId_ingredientId_key" ON "pantry_item"("householdId", "ingredientId");

-- AddForeignKey
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_member" ADD CONSTRAINT "household_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_preferences" ADD CONSTRAINT "household_preferences_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_preferences" ADD CONSTRAINT "member_preferences_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "household_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal" ADD CONSTRAINT "meal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_component" ADD CONSTRAINT "meal_component_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_component" ADD CONSTRAINT "meal_component_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan" ADD CONSTRAINT "meal_plan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "meal_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
