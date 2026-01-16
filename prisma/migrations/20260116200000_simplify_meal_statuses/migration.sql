-- Simplify MealPlanEntryStatus enum by removing eating_out and leftovers
-- These statuses are being consolidated into 'skipped'

-- Step 1: Update any existing entries with eating_out or leftovers status to skipped
UPDATE "meal_plan_entry" SET "status" = 'skipped' WHERE "status" IN ('eating_out', 'leftovers');

-- Step 2: Remove the enum values
-- PostgreSQL requires creating a new enum type, updating the column, then dropping the old type
CREATE TYPE "MealPlanEntryStatus_new" AS ENUM ('planned', 'completed', 'skipped');

-- Step 3: Drop the default before changing the column type
ALTER TABLE "meal_plan_entry" ALTER COLUMN "status" DROP DEFAULT;

-- Step 4: Change the column type
ALTER TABLE "meal_plan_entry" ALTER COLUMN "status" TYPE "MealPlanEntryStatus_new" USING ("status"::text::"MealPlanEntryStatus_new");

-- Step 5: Re-add the default
ALTER TABLE "meal_plan_entry" ALTER COLUMN "status" SET DEFAULT 'planned'::"MealPlanEntryStatus_new";

-- Step 6: Swap the enum types
DROP TYPE "MealPlanEntryStatus";
ALTER TYPE "MealPlanEntryStatus_new" RENAME TO "MealPlanEntryStatus";
