-- AlterTable: record that completing an entry charged the pantry, so
-- complete → revert to planned → complete charges it once (HON-651). The
-- deduction guard used to key on the stored status, which a revert resets.
ALTER TABLE "meal_plan_entry" ADD COLUMN "pantryDeductedAt" TIMESTAMP(3);

-- Backfill: a best estimate of which existing entries were charged, since the
-- route never recorded it. `MealCard` is the only client that completes an
-- entry, and it always sends `deductPantry: true` (the deduction modal has no
-- "complete without deducting" option), so a completed entry was charged
-- unless there was nothing to charge. The route skips the deduction for a meal
-- with no components, so those rows stay unmarked, matching what the route
-- itself does at runtime.
--
-- Two cases this cannot tell apart, both rare and both past-dated: an entry
-- completed before pantry deduction shipped (#182, 2026-01-16), and a meal
-- whose components changed after completion. Marking one of those means a
-- revert and re-complete charges nothing. Leaving every row unmarked instead
-- would double-charge every revert and re-complete of an existing entry, which
-- is the bug this migration fixes.
--
-- The real deduction time is unknown, so the migration time stands in for it.
-- Nothing reads the value, only whether it is set.
UPDATE "meal_plan_entry" AS e
SET "pantryDeductedAt" = CURRENT_TIMESTAMP
WHERE e."status" = 'completed'
  AND EXISTS (SELECT 1 FROM "meal_component" AS c WHERE c."mealId" = e."mealId");
