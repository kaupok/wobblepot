-- HON-1486: an ingredient's nutrition is for the form you buy it in (HON-1473,
-- HON-1479). Raw prawns held cooked shrimp values, about a fifth more protein
-- and calories per 100 g than the raw prawns a recipe weighs. Every shellfish
-- row now holds the USDA SR Legacy entry for the form a shop sells: raw for
-- prawns, scallops, squid and live mussels, cooked for crab legs and crayfish,
-- tinned for clam meat. Global rows only: a household typed its own values from
-- a pack label. `pnpm db:seed` never rewrites existing nutrition, so the seed
-- values need this migration.

UPDATE "ingredient" SET "calories" = 85, "protein" = 20.1, "carbs" = 0, "fat" = 0.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('prawns', 'king prawn', 'tiger prawn');

UPDATE "ingredient" SET "calories" = 97, "protein" = 19.4, "carbs" = 0, "fat" = 1.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('king crab', 'crab leg', 'crab meat');

UPDATE "ingredient" SET "calories" = 77, "protein" = 16.5, "carbs" = 0, "fat" = 0.8, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lobster tail');

UPDATE "ingredient" SET "calories" = 82, "protein" = 16.8, "carbs" = 0, "fat" = 1.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('crayfish');

UPDATE "ingredient" SET "calories" = 86, "protein" = 11.9, "carbs" = 3.7, "fat" = 2.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('mussels');

UPDATE "ingredient" SET "calories" = 172, "protein" = 23.8, "carbs" = 7.4, "fat" = 4.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('smoked mussel');

UPDATE "ingredient" SET "calories" = 86, "protein" = 14.7, "carbs" = 3.6, "fat" = 1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('clams');

UPDATE "ingredient" SET "calories" = 142, "protein" = 24.2, "carbs" = 5.9, "fat" = 1.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('clam meat');

UPDATE "ingredient" SET "calories" = 69, "protein" = 12.1, "carbs" = 3.2, "fat" = 0.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('scallops');

UPDATE "ingredient" SET "calories" = 92, "protein" = 15.6, "carbs" = 3.1, "fat" = 1.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('squid');

UPDATE "ingredient" SET "calories" = 82, "protein" = 14.9, "carbs" = 2.2, "fat" = 1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('octopus');

UPDATE "ingredient" SET "calories" = 81, "protein" = 9.5, "carbs" = 5, "fat" = 2.3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('oysters');

UPDATE "ingredient" SET "calories" = 137, "protein" = 23.8, "carbs" = 7.8, "fat" = 0.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('conch');
