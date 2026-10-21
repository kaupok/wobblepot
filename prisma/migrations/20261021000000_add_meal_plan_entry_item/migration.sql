-- Fridge meals (HON-1277): an entry with no recipe, made of items from the
-- pantry, from a recent meal's leftovers, or free text. `kind` tells a fridge
-- meal apart from a placeholder or a note-only card, which also have no
-- `mealId`. Additive only: every existing row gets `kind = 'meal'`.
-- CreateEnum
CREATE TYPE "MealPlanEntryKind" AS ENUM ('meal', 'fridge');

-- AlterTable
ALTER TABLE "meal_plan_entry" ADD COLUMN     "kind" "MealPlanEntryKind" NOT NULL DEFAULT 'meal';

-- CreateTable
CREATE TABLE "meal_plan_entry_item" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "sourceEntryId" TEXT,
    "label" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "meal_plan_entry_item_pkey" PRIMARY KEY ("id"),
    -- An item has exactly one source: a pantry ingredient, a recent entry, or text.
    CONSTRAINT "meal_plan_entry_item_one_source" CHECK (num_nonnulls("ingredientId", "sourceEntryId", "label") = 1)
);

-- CreateIndex
CREATE INDEX "meal_plan_entry_item_entryId_idx" ON "meal_plan_entry_item"("entryId");

-- CreateIndex
CREATE INDEX "meal_plan_entry_item_ingredientId_idx" ON "meal_plan_entry_item"("ingredientId");

-- CreateIndex
CREATE INDEX "meal_plan_entry_item_sourceEntryId_idx" ON "meal_plan_entry_item"("sourceEntryId");

-- AddForeignKey
ALTER TABLE "meal_plan_entry_item" ADD CONSTRAINT "meal_plan_entry_item_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "meal_plan_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry_item" ADD CONSTRAINT "meal_plan_entry_item_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry_item" ADD CONSTRAINT "meal_plan_entry_item_sourceEntryId_fkey" FOREIGN KEY ("sourceEntryId") REFERENCES "meal_plan_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A leftover item keeps its words when its source entry goes (Clear, a day
-- range delete, a regeneration): before the source row is deleted, the item
-- becomes free text with the meal's name, in the household's language when
-- the meal has a translation. Without it the cascade would drop the item and
-- could leave a fridge meal with no items, whose Undo then fails. A source
-- with no meal keeps the cascade, because it has no name to keep.
CREATE FUNCTION "keep_fridge_leftover_items"() RETURNS trigger AS $$
BEGIN
  IF OLD."mealId" IS NOT NULL THEN
    UPDATE "meal_plan_entry_item"
    SET "label" = COALESCE(
          (SELECT mt."name"
             FROM "meal_translation" mt
             JOIN "meal_plan" p ON p."id" = OLD."planId"
             JOIN "household" h ON h."id" = p."householdId"
            WHERE mt."mealId" = OLD."mealId" AND mt."locale" = h."locale"),
          (SELECT m."name" FROM "meal" m WHERE m."id" = OLD."mealId")),
        "sourceEntryId" = NULL
    WHERE "sourceEntryId" = OLD."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meal_plan_entry_keep_fridge_leftover_items"
BEFORE DELETE ON "meal_plan_entry"
FOR EACH ROW EXECUTE FUNCTION "keep_fridge_leftover_items"();
