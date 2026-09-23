-- Backfill default pantry staples for existing households (HON-769).
-- New households get these from `seedDefaultStaples`
-- (src/lib/meal-planning/default-staples.ts); this gives every existing
-- household the same three rows: salt, black pepper and water, from the global
-- ingredient pool, as staples with no quantity.
--
-- Idempotent: NOT EXISTS skips any (household, ingredient) pair that already has
-- a pantry row, including one the household deliberately unmarked. A missing
-- global ingredient simply contributes no rows.
INSERT INTO "pantry_item" ("id", "householdId", "ingredientId", "quantity", "isStaple", "updatedAt")
SELECT gen_random_uuid()::text, h."id", i."id", NULL, true, now()
FROM "household" h
CROSS JOIN "ingredient" i
WHERE i."householdId" IS NULL
  AND i."name" IN ('salt', 'black pepper', 'water')
  AND NOT EXISTS (
    SELECT 1 FROM "pantry_item" p
    WHERE p."householdId" = h."id" AND p."ingredientId" = i."id"
  );
