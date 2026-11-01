-- HON-1568: `pickled gherkins` (HON-1553) and `capers` carry the subcategory
-- 'pickled', while the other pickle rows (`cornichons` and five more) carry
-- 'pickle', so a grouping by subcategory splits them. The seed writes
-- subcategory only when it creates a row, so an existing row needs this UPDATE.
--
-- Global rows only (householdId IS NULL): a household's own row is its data.
-- A fresh database gets 'pickle' from the seed, so nothing changes there.

UPDATE "ingredient"
SET "subcategory" = 'pickle'
WHERE "householdId" IS NULL
  AND "name" IN ('pickled gherkins', 'capers')
  AND "subcategory" = 'pickled';
