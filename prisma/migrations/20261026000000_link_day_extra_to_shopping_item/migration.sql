-- Link a free-text day extra to the manual shopping item it put on the list
-- (HON-1310), so Remove on the extra can take the item off again. SET NULL,
-- because "Clear checked" deletes ticked items and the extra must stay.
-- AlterTable
ALTER TABLE "day_extra" ADD COLUMN "customShoppingItemId" TEXT;

-- An ingredient extra's line is computed from the plan, so it never links.
ALTER TABLE "day_extra" ADD CONSTRAINT "day_extra_link_free_text_only" CHECK ("ingredientId" IS NULL OR "customShoppingItemId" IS NULL);

-- CreateIndex
CREATE INDEX "day_extra_customShoppingItemId_idx" ON "day_extra"("customShoppingItemId");

-- AddForeignKey
ALTER TABLE "day_extra" ADD CONSTRAINT "day_extra_customShoppingItemId_fkey" FOREIGN KEY ("customShoppingItemId") REFERENCES "custom_shopping_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: a free-text extra made before this migration copied its label to
-- a manual item right after it was saved. Link the item with the same name in
-- the same household, created within 10 seconds after the extra. A same-name
-- item from another time is the household's own and stays unlinked.
UPDATE "day_extra" AS e
SET "customShoppingItemId" = m."itemId"
FROM (
    SELECT DISTINCT ON (x."id") x."id" AS "extraId", i."id" AS "itemId"
    FROM "day_extra" AS x
    JOIN "custom_shopping_item" AS i
      ON i."householdId" = x."householdId"
     AND i."name" = x."label"
     AND i."createdAt" >= x."createdAt"
     AND i."createdAt" <= x."createdAt" + INTERVAL '10 seconds'
    WHERE x."label" IS NOT NULL
    ORDER BY x."id", i."createdAt"
) AS m
WHERE e."id" = m."extraId";
