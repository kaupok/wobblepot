-- HON-1473: an ingredient's nutrition is for the form you buy it in.
-- Dry pasta, rice, grains and lentils held cooked values while every write
-- path writes dry grams, so nutrition per serving showed about a third of the
-- real carbs and kcal. Three bean rows move from dry to canned, drained values
-- so every bean row means the same thing. Global rows only: a household typed
-- its own values from a pack label. `pnpm db:seed` never rewrites existing
-- nutrition or components, so the seed values need this migration.

UPDATE "ingredient" SET "calories" = 360, "protein" = 7, "carbs" = 79, "fat" = 0.6, "fiber" = 1.3
WHERE "householdId" IS NULL AND "name" IN ('white rice', 'long grain rice', 'basmati rice', 'jasmine rice');

UPDATE "ingredient" SET "calories" = 358, "protein" = 6.5, "carbs" = 79, "fat" = 0.5, "fiber" = 1
WHERE "householdId" IS NULL AND "name" IN ('arborio rice', 'risotto rice', 'short grain rice', 'sushi rice');

UPDATE "ingredient" SET "calories" = 367, "protein" = 7.5, "carbs" = 76, "fat" = 3.2, "fiber" = 3.6
WHERE "householdId" IS NULL AND "name" IN ('brown rice');

UPDATE "ingredient" SET "calories" = 357, "protein" = 14.7, "carbs" = 75, "fat" = 1.1, "fiber" = 6.2
WHERE "householdId" IS NULL AND "name" IN ('wild rice');

UPDATE "ingredient" SET "calories" = 371, "protein" = 13, "carbs" = 75, "fat" = 1.5, "fiber" = 3.2
WHERE "householdId" IS NULL AND "name" IN ('pasta', 'spaghetti', 'penne', 'fusilli', 'orzo', 'lasagne sheets', 'noodles');

UPDATE "ingredient" SET "calories" = 384, "protein" = 14, "carbs" = 71, "fat" = 4.4, "fiber" = 3.3
WHERE "householdId" IS NULL AND "name" IN ('tagliatelle', 'egg noodles');

UPDATE "ingredient" SET "calories" = 364, "protein" = 6, "carbs" = 80, "fat" = 0.6, "fiber" = 1.6
WHERE "householdId" IS NULL AND "name" IN ('rice noodles');

UPDATE "ingredient" SET "calories" = 336, "protein" = 14, "carbs" = 75, "fat" = 0.7, "fiber" = 4
WHERE "householdId" IS NULL AND "name" IN ('soba noodles');

UPDATE "ingredient" SET "calories" = 368, "protein" = 14, "carbs" = 64, "fat" = 6, "fiber" = 7
WHERE "householdId" IS NULL AND "name" IN ('quinoa');

UPDATE "ingredient" SET "calories" = 376, "protein" = 13, "carbs" = 77, "fat" = 0.6, "fiber" = 5
WHERE "householdId" IS NULL AND "name" IN ('couscous');

UPDATE "ingredient" SET "calories" = 342, "protein" = 12, "carbs" = 76, "fat" = 1.3, "fiber" = 18
WHERE "householdId" IS NULL AND "name" IN ('bulgur');

UPDATE "ingredient" SET "calories" = 346, "protein" = 12, "carbs" = 72, "fat" = 2.7, "fiber" = 10
WHERE "householdId" IS NULL AND "name" IN ('buckwheat');

UPDATE "ingredient" SET "calories" = 378, "protein" = 11, "carbs" = 73, "fat" = 4.2, "fiber" = 8.5
WHERE "householdId" IS NULL AND "name" IN ('millet');

UPDATE "ingredient" SET "calories" = 352, "protein" = 10, "carbs" = 78, "fat" = 1.2, "fiber" = 15.6
WHERE "householdId" IS NULL AND "name" IN ('barley', 'pearl barley');

UPDATE "ingredient" SET "calories" = 340, "protein" = 14, "carbs" = 68, "fat" = 2.5, "fiber" = 10
WHERE "householdId" IS NULL AND "name" IN ('farro');

UPDATE "ingredient" SET "calories" = 362, "protein" = 8, "carbs" = 77, "fat" = 3.6, "fiber" = 7
WHERE "householdId" IS NULL AND "name" IN ('polenta');

UPDATE "ingredient" SET "calories" = 352, "protein" = 25, "carbs" = 60, "fat" = 1.1, "fiber" = 11
WHERE "householdId" IS NULL AND "name" IN ('lentils', 'red lentils', 'green lentils', 'brown lentils', 'beluga lentils');

UPDATE "ingredient" SET "calories" = 341, "protein" = 25, "carbs" = 60, "fat" = 1.2, "fiber" = 25
WHERE "householdId" IS NULL AND "name" IN ('split peas');

UPDATE "ingredient" SET "calories" = 120, "protein" = 8, "carbs" = 20, "fat" = 0.5, "fiber" = 6
WHERE "householdId" IS NULL AND "name" IN ('borlotti beans', 'black-eyed beans', 'great northern beans');

-- Seed recipes that gave cooked-weight amounts, rescaled to dry weight
-- (x0.4 rice, lentils and split peas; x0.45 pasta and noodles; rounded to 5 g).
-- The old amount in the WHERE keeps a re-run safe.

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'white rice' AND mc."quantityPerServing" = 150
  AND m."name" IN ('Pork Fried Rice', 'Egg Fried Rice', 'Vegetable Fried Rice', 'Beef Bibimbap', 'Tuna Poke Bowl', 'Japanese Gyudon', 'Chicken Jambalaya', 'Salmon Teriyaki Bowl');

UPDATE "meal_component" AS mc SET "quantityPerServing" = 80
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'white rice' AND mc."quantityPerServing" = 200
  AND m."name" IN ('Duck Fried Rice');

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'basmati rice' AND mc."quantityPerServing" = 150
  AND m."name" IN ('Lamb Biryani', 'Lamb Pilaf');

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'red lentils' AND mc."quantityPerServing" = 150
  AND m."name" IN ('Red Lentil Dal', 'Dal Tadka');

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'split peas' AND mc."quantityPerServing" = 150
  AND m."name" IN ('Split Pea Soup');

UPDATE "meal_component" AS mc SET "quantityPerServing" = 65
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'noodles' AND mc."quantityPerServing" = 150
  AND m."name" IN ('Pork Lo Mein');

UPDATE "meal_component" AS mc SET "quantityPerServing" = 65
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'egg noodles' AND mc."quantityPerServing" = 150
  AND m."name" IN ('Pork Fried Noodles');

UPDATE "meal_component" AS mc SET "quantityPerServing" = 65
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NULL AND i."householdId" IS NULL
  AND i."name" = 'lasagne sheets' AND mc."quantityPerServing" = 150
  AND m."name" IN ('Classic Lasagne', 'Vegetable Lasagne');

-- "Make it my recipe" forks (forkMeal, src/lib/meal-plans/promote-entry.ts)
-- copy a library meal's components into a household meal on the same global
-- ingredient, with no link back to the source. A fork that still holds the old
-- cooked amount would read 2.5x high once the row holds dry values, so it is
-- rescaled too. It is found by name, in English or a translated name, and only
-- at the exact old amount: a renamed fork, or one the household edited, keeps
-- its amount.

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'white rice' AND mc."quantityPerServing" = 150
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Pork Fried Rice', 'Egg Fried Rice', 'Vegetable Fried Rice', 'Beef Bibimbap', 'Tuna Poke Bowl', 'Japanese Gyudon', 'Chicken Jambalaya', 'Salmon Teriyaki Bowl')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Pork Fried Rice', 'Egg Fried Rice', 'Vegetable Fried Rice', 'Beef Bibimbap', 'Tuna Poke Bowl', 'Japanese Gyudon', 'Chicken Jambalaya', 'Salmon Teriyaki Bowl')
  );

UPDATE "meal_component" AS mc SET "quantityPerServing" = 80
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'white rice' AND mc."quantityPerServing" = 200
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Duck Fried Rice')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Duck Fried Rice')
  );

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'basmati rice' AND mc."quantityPerServing" = 150
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Lamb Biryani', 'Lamb Pilaf')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Lamb Biryani', 'Lamb Pilaf')
  );

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'red lentils' AND mc."quantityPerServing" = 150
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Red Lentil Dal', 'Dal Tadka')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Red Lentil Dal', 'Dal Tadka')
  );

UPDATE "meal_component" AS mc SET "quantityPerServing" = 60
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'split peas' AND mc."quantityPerServing" = 150
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Split Pea Soup')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Split Pea Soup')
  );

UPDATE "meal_component" AS mc SET "quantityPerServing" = 65
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'noodles' AND mc."quantityPerServing" = 150
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Pork Lo Mein')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Pork Lo Mein')
  );

UPDATE "meal_component" AS mc SET "quantityPerServing" = 65
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'egg noodles' AND mc."quantityPerServing" = 150
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Pork Fried Noodles')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Pork Fried Noodles')
  );

UPDATE "meal_component" AS mc SET "quantityPerServing" = 65
FROM "meal" AS m, "ingredient" AS i
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND m."householdId" IS NOT NULL AND i."householdId" IS NULL
  AND i."name" = 'lasagne sheets' AND mc."quantityPerServing" = 150
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Classic Lasagne', 'Vegetable Lasagne')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Classic Lasagne', 'Vegetable Lasagne')
  );
