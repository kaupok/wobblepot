-- Leftover lunches (HON-1394): a leftover item can point at a dinner that is
-- still planned and carries the servings it takes, so the dinner is cooked and
-- bought for its own servings plus those. The entry stores the total it was
-- completed at, so a later change to a lunch does not move what the pantry
-- was charged for. Additive only: both columns are nullable.
-- AlterTable
ALTER TABLE "meal_plan_entry" ADD COLUMN     "cookedServings" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "meal_plan_entry_item" ADD COLUMN     "servings" DOUBLE PRECISION;

-- The delete trigger from 20261021000000_add_meal_plan_entry_item now also
-- drops the item's servings: a free-text item has none, and Edit items would
-- otherwise send back a number the schema refuses on a label.
CREATE OR REPLACE FUNCTION "keep_fridge_leftover_items"() RETURNS trigger AS $$
BEGIN
  IF OLD."mealId" IS NOT NULL THEN
    UPDATE "meal_plan_entry_item"
    SET "label" = LEFT(COALESCE(
          (SELECT mt."name"
             FROM "meal_translation" mt
             JOIN "meal_plan" p ON p."id" = OLD."planId"
             JOIN "household" h ON h."id" = p."householdId"
            WHERE mt."mealId" = OLD."mealId" AND mt."locale" = h."locale"),
          (SELECT m."name" FROM "meal" m WHERE m."id" = OLD."mealId")), 80),
        "sourceEntryId" = NULL,
        "servings" = NULL
    WHERE "sourceEntryId" = OLD."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
