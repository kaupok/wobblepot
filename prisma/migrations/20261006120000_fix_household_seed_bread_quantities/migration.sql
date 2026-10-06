-- HON-1033: household copies of the 14 bread seed meals still store a slice
-- count of bread as grams (2 g per serving, 1 g for Chicken Caesar Salad).
-- 20261003170000_fix_seed_bread_quantities (HON-1029) fixed the global meals
-- only. No route copies a global meal into a household today, so only
-- existing rows need repair.
--
-- A household meal is the household's own data, so a row is matched only
-- while it still holds the seed's old value: on a global `bread` ingredient,
-- on one of the 14 meal names, and at exactly 2 g (1 g for Chicken Caesar
-- Salad). A row at any other value is the household's choice and is left
-- alone. Global meals (householdId IS NULL) are not touched, and a second run
-- changes nothing.
WITH fixed AS (
  UPDATE "meal_component" AS mc
  SET "quantityPerServing" = fix.new_quantity
  FROM
    (VALUES
      ('Bacon and Egg Breakfast',    2::double precision, 70::double precision),
      ('Scrambled Eggs with Toast',  2, 70),
      ('Avocado Toast',              2, 70),
      ('Chicken Caesar Salad',       1, 35),
      ('Turkey Burgers',             2, 70),
      ('BBQ Pork Sandwich',          2, 70),
      ('Bacon Egg Sandwich',         2, 70),
      ('Peanut Butter Banana Toast', 2, 70),
      ('Turkey Burger',              2, 70),
      ('BLT Sandwich',               2, 70),
      ('Tuna Salad Sandwich',        2, 70),
      ('Grilled Cheese Sandwich',    2, 70),
      ('Shakshuka with Feta',        2, 70),
      ('BBQ Pulled Pork',            2, 70)
    ) AS fix (meal_name, old_quantity, new_quantity),
    "meal" AS m,
    "ingredient" AS i
  WHERE mc."mealId" = m."id"
    AND mc."ingredientId" = i."id"
    AND m."householdId" IS NOT NULL
    AND i."householdId" IS NULL
    AND i."name" = 'bread'
    AND m."name" = fix.meal_name
    AND mc."quantityPerServing" = fix.old_quantity
  RETURNING mc."mealId"
),
-- Cached prep tips were written from the old quantity (HON-683). Clear them
-- so the next open regenerates from the fixed one. PostgreSQL runs a
-- data-modifying WITH statement even when the main query does not reference
-- it.
cleared_tips AS (
  UPDATE "meal_plan_entry"
  SET "preparationTips" = NULL
  WHERE "mealId" IN (SELECT "mealId" FROM fixed)
    AND "preparationTips" IS NOT NULL
)
-- `updatedAt` moves so the prep-tips route's HON-683 guard rejects a tips
-- write that started before this migration. The image columns are left
-- alone, unlike HON-1029: a household meal redraws through
-- `POST /api/meals/[id]/image`, which charges the household's AI cap, and a
-- household copy shares the global meal's image blob. The quantity change
-- does not justify that cost to the household.
UPDATE "meal"
SET "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "mealId" FROM fixed);
