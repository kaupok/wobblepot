-- HON-1029: 14 global seed meals stored a slice count of bread as grams
-- (1 or 2 g per serving), and Spinach Artichoke Pasta stored 1 g of artichoke.
-- `pnpm db:seed` never updates an existing meal's components, so this
-- migration carries the corrected seed values to existing databases.
--
-- Only global meals and global ingredients (householdId IS NULL) are touched:
-- household meals are the household's own data. Each row is matched on its
-- old value too, so a row that is already right is left alone and a second
-- run changes nothing.
WITH fixed AS (
  UPDATE "meal_component" AS mc
  SET "quantityPerServing" = fix.new_quantity
  FROM
    (VALUES
      ('Bacon and Egg Breakfast',    'bread',     2::double precision, 70::double precision),
      ('Scrambled Eggs with Toast',  'bread',     2, 70),
      ('Avocado Toast',              'bread',     2, 70),
      ('Chicken Caesar Salad',       'bread',     1, 35),
      ('Turkey Burgers',             'bread',     2, 70),
      ('BBQ Pork Sandwich',          'bread',     2, 70),
      ('Bacon Egg Sandwich',         'bread',     2, 70),
      ('Peanut Butter Banana Toast', 'bread',     2, 70),
      ('Turkey Burger',              'bread',     2, 70),
      ('BLT Sandwich',               'bread',     2, 70),
      ('Tuna Salad Sandwich',        'bread',     2, 70),
      ('Grilled Cheese Sandwich',    'bread',     2, 70),
      ('Shakshuka with Feta',        'bread',     2, 70),
      ('BBQ Pulled Pork',            'bread',     2, 70),
      ('Spinach Artichoke Pasta',    'artichoke', 1, 60)
    ) AS fix (meal_name, ingredient_name, old_quantity, new_quantity),
    "meal" AS m,
    "ingredient" AS i
  WHERE mc."mealId" = m."id"
    AND mc."ingredientId" = i."id"
    AND m."householdId" IS NULL
    AND i."householdId" IS NULL
    AND m."name" = fix.meal_name
    AND i."name" = fix.ingredient_name
    AND mc."quantityPerServing" = fix.old_quantity
  RETURNING mc."mealId"
),
-- Cached prep tips were written from the old ingredient list, which
-- `PATCH /api/households/me/meals/[id]` treats as a tips input (HON-683).
-- Clear them so the next open regenerates from the fixed quantities.
-- PostgreSQL runs a data-modifying WITH statement even when the main query
-- does not reference it.
cleared_tips AS (
  UPDATE "meal_plan_entry"
  SET "preparationTips" = NULL
  WHERE "mealId" IN (SELECT "mealId" FROM fixed)
    AND "preparationTips" IS NOT NULL
)
-- The illustration depicts the components (`clearMealImage`), and the image
-- prompt lists ingredients by weight, so the changed meals go back to the
-- global image batch's NEEDS_IMAGE selection (docs/DEPLOYMENT.md → Global
-- meal illustrations). The old blob is not deleted: a migration cannot reach
-- Blob, and a household copy of the meal may still point at it. `updatedAt`
-- moves too, so the prep-tips route's HON-683 guard rejects a tips write that
-- started before this migration.
UPDATE "meal"
SET "updatedAt" = CURRENT_TIMESTAMP,
    "imageUrl" = NULL,
    "imagePromptVersion" = NULL,
    "imageStatus" = 'none',
    "imageClaimedAt" = NULL,
    "imageAttempts" = 0,
    "imageHue" = NULL
WHERE "id" IN (SELECT "mealId" FROM fixed);
