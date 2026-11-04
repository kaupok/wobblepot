-- HON-1576: the generic `bread` and `tortilla` rows carry the subcategory
-- 'grain', so the Cooked dialog treats them as cupboard items and proposes
-- "Some left" (HON-1563). The other bread rows use 'bread' and 'flatbread',
-- which the rule treats as fresh. The seed writes subcategory only when it
-- creates a row, so an existing row needs this UPDATE.
--
-- Global rows only (householdId IS NULL): a household's own row is its data.
-- A fresh database gets the new values from the seed, so nothing changes there.

UPDATE "ingredient"
SET "subcategory" = 'bread'
WHERE "householdId" IS NULL
  AND "name" = 'bread'
  AND "subcategory" = 'grain';

UPDATE "ingredient"
SET "subcategory" = 'flatbread'
WHERE "householdId" IS NULL
  AND "name" = 'tortilla'
  AND "subcategory" = 'grain';
