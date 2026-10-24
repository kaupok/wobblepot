-- Day extras (HON-1309): a snack, a drink or another item a household adds to
-- a day, outside its meals. Keyed by household, so a plan regeneration, which
-- deletes entries, never reaches it.
-- CreateTable
CREATE TABLE "day_extra" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "ingredientId" TEXT,
    "label" TEXT,
    "quantity" DOUBLE PRECISION,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_extra_pkey" PRIMARY KEY ("id"),
    -- An extra is a catalogue ingredient or free text, never both. Free text has no amount.
    CONSTRAINT "day_extra_one_source" CHECK (num_nonnulls("ingredientId", "label") = 1 AND ("label" IS NULL OR "quantity" IS NULL))
);

-- CreateIndex
CREATE INDEX "day_extra_householdId_date_idx" ON "day_extra"("householdId", "date");

-- CreateIndex
CREATE INDEX "day_extra_ingredientId_idx" ON "day_extra"("ingredientId");

-- AddForeignKey
ALTER TABLE "day_extra" ADD CONSTRAINT "day_extra_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_extra" ADD CONSTRAINT "day_extra_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
