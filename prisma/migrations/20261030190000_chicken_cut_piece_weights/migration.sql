-- HON-1491: no chicken cut row had a piece weight, so "4 chicken thighs" in
-- pieces fell back to 30 g a piece (DEFAULT_GRAMS_PER_PIECE) and counted as
-- 120 g. Each row now holds the USDA FoodData Central piece weight, as sold:
-- bone in for the bone-in cuts, boneless for the breast and the thigh fillet.
-- Global rows only: a household set its own row's weight. A re-seed refreshes
-- gramsPerPiece too, but a database that is not re-seeded needs this migration.

UPDATE "ingredient" SET "gramsPerPiece" = 272 WHERE "householdId" IS NULL AND "name" = 'chicken breast';

UPDATE "ingredient" SET "gramsPerPiece" = 193 WHERE "householdId" IS NULL AND "name" = 'chicken thigh';

UPDATE "ingredient" SET "gramsPerPiece" = 149 WHERE "householdId" IS NULL AND "name" = 'chicken thigh fillet';

UPDATE "ingredient" SET "gramsPerPiece" = 130 WHERE "householdId" IS NULL AND "name" = 'chicken drumstick';

UPDATE "ingredient" SET "gramsPerPiece" = 296 WHERE "householdId" IS NULL AND "name" = 'chicken leg';

UPDATE "ingredient" SET "gramsPerPiece" = 107 WHERE "householdId" IS NULL AND "name" = 'chicken wing';
