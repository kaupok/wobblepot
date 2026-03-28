-- Migration: Continuous Meal Plan
-- Replace per-week meal plans with a single long-lived plan per household.
-- Steps:
-- 1. For each household, pick the most recently created plan as "keeper"
-- 2. Re-parent all entries from other plans to the keeper
-- 3. Handle duplicate entries (same planId + date + mealType) by keeping the most recent
-- 4. Delete orphaned plans
-- 5. Drop startDate/endDate columns
-- 6. Change unique constraint from (householdId, startDate) to (householdId)

-- Step 1 & 2: Re-parent entries from non-keeper plans to keeper plans.
-- The keeper is the most recently created plan per household.
-- We use a CTE to identify keeper plans, then update entries.
WITH keeper_plans AS (
  SELECT DISTINCT ON ("householdId") id, "householdId"
  FROM "meal_plan"
  ORDER BY "householdId", "createdAt" DESC
)
UPDATE "meal_plan_entry" e
SET "planId" = k.id
FROM "meal_plan" p
JOIN keeper_plans k ON k."householdId" = p."householdId"
WHERE e."planId" = p.id
  AND p.id != k.id;

-- Step 3: Remove duplicate entries (same planId + date + mealType).
-- After re-parenting, there may be duplicates. Keep the one with the latest id (most recently created).
DELETE FROM "meal_plan_entry" e
USING (
  SELECT "planId", "date", "mealType", MAX(id) AS keep_id
  FROM "meal_plan_entry"
  GROUP BY "planId", "date", "mealType"
  HAVING COUNT(*) > 1
) dups
WHERE e."planId" = dups."planId"
  AND e."date" = dups."date"
  AND e."mealType" = dups."mealType"
  AND e.id != dups.keep_id;

-- Step 4: Delete orphaned plans (non-keepers, now empty).
WITH keeper_plans AS (
  SELECT DISTINCT ON ("householdId") id
  FROM "meal_plan"
  ORDER BY "householdId", "createdAt" DESC
)
DELETE FROM "meal_plan"
WHERE id NOT IN (SELECT id FROM keeper_plans);

-- Step 5: Drop old unique constraint and columns.
ALTER TABLE "meal_plan" DROP CONSTRAINT IF EXISTS "meal_plan_householdId_startDate_key";
ALTER TABLE "meal_plan" DROP COLUMN IF EXISTS "startDate";
ALTER TABLE "meal_plan" DROP COLUMN IF EXISTS "endDate";

-- Step 6: Add new unique constraint (one plan per household).
ALTER TABLE "meal_plan" ADD CONSTRAINT "meal_plan_householdId_key" UNIQUE ("householdId");
