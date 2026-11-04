-- HON-1597: an ingredient's nutrition is for the form you buy it in (HON-1473,
-- HON-1479, HON-1486). A shop sells mussels, clams, oysters, crayfish and whole
-- lobster in the shell, and a recipe weighs them in the shell, but their rows
-- held USDA values for the meat alone. Each row now holds the meat values times
-- a cited edible part (`asSold` in prisma/as-sold-nutrition.ts). Global rows
-- only: a household typed its own values from a pack label. `pnpm db:seed`
-- never rewrites existing nutrition, so the seed values need this migration.

UPDATE "ingredient" SET "calories" = 20.6, "protein" = 2.9, "carbs" = 0.9, "fat" = 0.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('mussels');

UPDATE "ingredient" SET "calories" = 12.9, "protein" = 2.2, "carbs" = 0.5, "fat" = 0.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('clams');

UPDATE "ingredient" SET "calories" = 8.1, "protein" = 1, "carbs" = 0.5, "fat" = 0.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('oysters');

UPDATE "ingredient" SET "calories" = 12.3, "protein" = 2.5, "carbs" = 0, "fat" = 0.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('crayfish');

UPDATE "ingredient" SET "calories" = 32, "protein" = 6.8, "carbs" = 0, "fat" = 0.3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lobster');

-- The library meal "Lobster Tail" weighs 200 g of a shell-on tail, but its
-- component pointed at whole `lobster`, which now holds a third of the meat
-- values. It moves to `lobster tail`, which keeps the meat values. `pnpm
-- db:seed` never rewrites the components of an existing meal, so this
-- migration does. "Make it my recipe" forks (forkMeal,
-- src/lib/meal-plans/promote-entry.ts) copy the component onto the same global
-- row, so a fork found by name (English or a translated name) at the old 200 g
-- moves too; a renamed or edited fork keeps its component. A meal that already
-- has a `lobster tail` component is left alone, because a meal holds an
-- ingredient once.

UPDATE "meal_component" AS mc SET "ingredientId" = tail."id"
FROM "meal" AS m, "ingredient" AS whole, "ingredient" AS tail
WHERE mc."mealId" = m."id" AND mc."ingredientId" = whole."id"
  AND whole."householdId" IS NULL AND whole."name" = 'lobster'
  AND tail."householdId" IS NULL AND tail."name" = 'lobster tail'
  AND mc."quantityPerServing" = 200
  AND NOT EXISTS (
    SELECT 1 FROM "meal_component" AS other
    WHERE other."mealId" = m."id" AND other."ingredientId" = tail."id"
  )
  AND (
    (m."householdId" IS NULL AND m."name" = 'Lobster Tail')
    OR (m."householdId" IS NOT NULL AND m."name" IN (
      SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" = 'Lobster Tail'
      UNION
      SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
      WHERE g."householdId" IS NULL AND g."name" = 'Lobster Tail'
    ))
  );
