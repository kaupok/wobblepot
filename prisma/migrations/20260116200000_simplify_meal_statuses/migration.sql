-- Simplify MealPlanEntryStatus enum by removing eating_out and leftovers
-- These statuses are being consolidated into 'skipped'

-- Step 1: Update any existing entries with eating_out or leftovers status to skipped
UPDATE "meal_plan_entry" SET "status" = 'skipped' WHERE "status" IN ('eating_out', 'leftovers');

-- Step 2: Remove the enum values
-- PostgreSQL requires creating a new enum type, updating the column, then dropping the old type
CREATE TYPE "MealPlanEntryStatus_new" AS ENUM ('planned', 'completed', 'skipped');

ALTER TABLE "meal_plan_entry" ALTER COLUMN "status" TYPE "MealPlanEntryStatus_new" USING ("status"::text::"MealPlanEntryStatus_new");

DROP TYPE "MealPlanEntryStatus";

ALTER TYPE "MealPlanEntryStatus_new" RENAME TO "MealPlanEntryStatus";
