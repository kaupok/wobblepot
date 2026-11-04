-- HON-1487: an ingredient's nutrition is for the form you buy it in (HON-1473,
-- HON-1479). The plain `sardines` and `anchovies` rows held USDA values for fish
-- canned in oil and drained, so a recipe with fresh fish counted the oil. The
-- tinned fish has its own `tinned sardines` and `tinned anchovies` rows, as for
-- every other fish. Both plain rows now hold raw values for the whole fish, the
-- raw edible values × the edible part (0.62, FAO 309), through `asSold`. Global
-- rows only: a household typed its own values from a pack label. `pnpm db:seed`
-- never rewrites existing nutrition, so the seed values need this migration.

UPDATE "ingredient" SET "calories" = 99.2, "protein" = 12.1, "carbs" = 0, "fat" = 5.7, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('sardines');

UPDATE "ingredient" SET "calories" = 81.2, "protein" = 12.6, "carbs" = 0, "fat" = 3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('anchovies');
