-- HON-1550: an ingredient's nutrition is for the form you buy it in.
-- Mung, adzuki and soy beans are sold dry, not tinned, but their rows held
-- cooked values, so a recipe that names 100 g showed about a third of the real
-- kcal and protein. These rows now hold raw, dry values; the other bean rows
-- stay the drained tin. Global rows only: a household typed its own values
-- from a pack label. `pnpm db:seed` never rewrites existing nutrition, so the
-- seed values need this migration. No recipe uses these rows, so no component
-- amount changes.

UPDATE "ingredient" SET "calories" = 347, "protein" = 23.9, "carbs" = 62.6, "fat" = 1.1, "fiber" = 16.3
WHERE "householdId" IS NULL AND "name" IN ('mung beans');

UPDATE "ingredient" SET "calories" = 329, "protein" = 19.9, "carbs" = 62.9, "fat" = 0.5, "fiber" = 12.7
WHERE "householdId" IS NULL AND "name" IN ('adzuki beans');

UPDATE "ingredient" SET "calories" = 446, "protein" = 36.5, "carbs" = 30.2, "fat" = 19.9, "fiber" = 9.3
WHERE "householdId" IS NULL AND "name" IN ('soybeans');
