-- Per-entry ingredient changes (HON-1243): replace, leave out or add one
-- ingredient on one planned entry, never on the shared meal. Additive only.
-- `adjustmentNote` is for the AI "Adjust recipe" path (HON-1244); nothing
-- writes it yet. The one-row-per-original and one-add-per-ingredient rules
-- live in `addEntryChange`, because nulls are distinct in a unique index.
-- AlterTable
ALTER TABLE "meal_plan_entry" ADD COLUMN     "adjustmentNote" TEXT;

-- CreateTable
CREATE TABLE "meal_plan_entry_component" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "originalIngredientId" TEXT,
    "replacementIngredientId" TEXT,
    "quantityPerServing" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_plan_entry_component_pkey" PRIMARY KEY ("id"),
    -- A change names at least one ingredient: null and null would mean nothing.
    CONSTRAINT "meal_plan_entry_component_names_ingredient" CHECK ("originalIngredientId" IS NOT NULL OR "replacementIngredientId" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "meal_plan_entry_component_entryId_idx" ON "meal_plan_entry_component"("entryId");

-- CreateIndex
CREATE INDEX "meal_plan_entry_component_originalIngredientId_idx" ON "meal_plan_entry_component"("originalIngredientId");

-- CreateIndex
CREATE INDEX "meal_plan_entry_component_replacementIngredientId_idx" ON "meal_plan_entry_component"("replacementIngredientId");

-- AddForeignKey
ALTER TABLE "meal_plan_entry_component" ADD CONSTRAINT "meal_plan_entry_component_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "meal_plan_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry_component" ADD CONSTRAINT "meal_plan_entry_component_originalIngredientId_fkey" FOREIGN KEY ("originalIngredientId") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_entry_component" ADD CONSTRAINT "meal_plan_entry_component_replacementIngredientId_fkey" FOREIGN KEY ("replacementIngredientId") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

