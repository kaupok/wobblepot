-- HON-1029: 14 global seed meals stored a slice count of bread as grams
-- (1 or 2 g per serving), and Spinach Artichoke Pasta stored 1 g of artichoke.
-- `pnpm db:seed` never updates an existing meal's components, so this
-- migration carries the corrected seed values to existing databases.
--
-- Only global meals and global ingredients (householdId IS NULL) are touched:
-- household meals are the household's own data. Each row is matched on its
-- old value too, so a row that is already right is left alone and a second
-- run changes nothing.
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
  AND mc."quantityPerServing" = fix.old_quantity;
