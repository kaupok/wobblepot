-- HON-1603: the plain `anchovies` row holds raw whole-fish values (HON-1487),
-- but a recipe that says "anchovies" or "anchovy fillets" means the tinned or
-- jarred fillets, which `tinned anchovies` holds. The row name now says its
-- form, as `fresh basil` does, and the plain name resolves to the tinned row
-- through `src/lib/ingredient-aliases.ts`. Rename the seeded global row in
-- place: same id, so meal components, pantry rows, shopping items and
-- translations follow it.
UPDATE "ingredient"
SET "name" = 'fresh anchovies'
WHERE "name" = 'anchovies'
  AND "householdId" IS NULL;
