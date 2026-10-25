-- Backfill, second pass (HON-1310): an extra added while its label was already
-- on the list as a linked item shared that item (the `exists` rule in
-- `createDayExtra`). Link it too, so Remove on one of them keeps the item for
-- the other. An item no extra links to was typed by hand and stays unlinked.
UPDATE "day_extra" AS e
SET "customShoppingItemId" = i."id"
FROM "custom_shopping_item" AS i
WHERE e."label" IS NOT NULL
  AND e."customShoppingItemId" IS NULL
  AND i."householdId" = e."householdId"
  AND i."name" = e."label"
  AND i."createdAt" < e."createdAt"
  AND EXISTS (SELECT 1 FROM "day_extra" AS l WHERE l."customShoppingItemId" = i."id");
