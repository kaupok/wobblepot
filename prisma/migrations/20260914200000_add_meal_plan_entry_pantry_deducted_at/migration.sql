-- AlterTable: record that completing an entry charged the pantry, so
-- complete → revert to planned → complete charges it once (HON-651). The
-- deduction guard used to key on the stored status, which a revert resets.
ALTER TABLE "meal_plan_entry" ADD COLUMN "pantryDeductedAt" TIMESTAMP(3);

-- Backfill: every entry that is completed today was charged. `MealCard` is the
-- only client that completes an entry, and it always sends `deductPantry: true`
-- (the deduction modal has no "complete without deducting" option). Without
-- this, reverting and re-completing a pre-migration entry would still charge
-- the pantry a second time. The real deduction time was never recorded, so the
-- migration time stands in for it; nothing reads the value, only its presence.
UPDATE "meal_plan_entry" SET "pantryDeductedAt" = CURRENT_TIMESTAMP WHERE "status" = 'completed';
