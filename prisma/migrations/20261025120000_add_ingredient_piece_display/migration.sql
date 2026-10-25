-- Show gram-stored vegetables as pieces (HON-1312). Display only: no stored
-- quantity changes. The rule lives in prisma/piece-display.ts, which the seed
-- reads. The two lists below repeat it by hand, because a migration cannot
-- import TypeScript; prisma/piece-display.test.ts fails when they drift.
--
-- Household-owned ingredients keep the default 'none'.

-- CreateEnum
CREATE TYPE "PieceDisplay" AS ENUM ('none', 'recipe', 'recipe_and_shopping');

-- AlterTable
ALTER TABLE "ingredient" ADD COLUMN "pieceDisplay" "PieceDisplay" NOT NULL DEFAULT 'none';

-- Pieces in the recipe and on the shopping list.
UPDATE "ingredient"
SET "pieceDisplay" = 'recipe_and_shopping'
WHERE "householdId" IS NULL
  AND "name" IN (
    'onion',
    'carrot',
    'tomato',
    'garlic',
    'bell pepper',
    'red pepper',
    'cucumber',
    'courgette'
  );

-- Pieces in the recipe, grams on the shopping list: sold loose by weight.
UPDATE "ingredient"
SET "pieceDisplay" = 'recipe'
WHERE "householdId" IS NULL
  AND "name" IN (
    'potato',
    'sweet potato'
  );
