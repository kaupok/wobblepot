-- HON-1492: chicken cutlet and chicken tender had no piece weight, so
-- "4 chicken cutlets" fell back to 30 g a piece (DEFAULT_GRAMS_PER_PIECE) and
-- counted as 120 g. USDA FoodData Central has no portion record for either, so
-- each weight derives from the 272 g USDA breast: a cutlet is half a breast, a
-- tender about 15% of one. Chicken strip keeps the fallback: a strip has no
-- standard size. Global rows only: a household set its own row's weight.

UPDATE "ingredient" SET "gramsPerPiece" = 136 WHERE "householdId" IS NULL AND "name" = 'chicken cutlet';

UPDATE "ingredient" SET "gramsPerPiece" = 40 WHERE "householdId" IS NULL AND "name" = 'chicken tender';
