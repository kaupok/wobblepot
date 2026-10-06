-- Mark the global ingredients a cook measures by volume (HON-1069).
-- The rule lives in prisma/measured-by-volume.ts, which the seed reads. The
-- three lists below repeat it by hand, because a migration cannot import
-- TypeScript; prisma/measured-by-volume.test.ts fails when they drift.
--
-- Household-owned ingredients keep the default false.
ALTER TABLE "ingredient" ADD COLUMN "measuredByVolume" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ingredient"
SET "measuredByVolume" = true
WHERE "householdId" IS NULL
  AND (
    "subcategory" IN (
      'liquid',
      'oil',
      'infused oil',
      'vinegar',
      'cooking wine',
      'spirit',
      'milk',
      'milk alternative',
      'broth',
      'citrus juice',
      'extract'
    )
    OR "name" IN (
      'heavy cream',
      'double cream',
      'whipping cream',
      'soy sauce',
      'light soy sauce',
      'dark soy sauce',
      'sweet soy sauce',
      'tamari',
      'fish sauce',
      'fish sauce thai',
      'ponzu',
      'mentsuyu',
      'worcestershire sauce',
      'hot sauce',
      'teriyaki sauce',
      'coconut aminos',
      'tucupi',
      'vinegar',
      'balsamic vinegar',
      'canola oil',
      'half and half'
    )
  )
  AND "name" NOT IN (
    'coconut oil',
    'palm oil',
    'condensed milk',
    'guarana'
  );
