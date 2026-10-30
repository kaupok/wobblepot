-- HON-1479: an ingredient's nutrition is for the form you buy it in.
-- Meat and poultry rows held roasted values, about a third more protein per
-- 100 g than raw meat. Bone-in cuts and whole fish counted the bone as meat, so
-- a bone-in chicken recipe showed two to two and a half times its protein.
-- Every meat, poultry and fish row now holds raw values, and a bone-in or whole
-- row holds them per 100 g as bought, bone included (asSold in
-- prisma/as-sold-nutrition.ts). Global rows only: a household typed its own
-- values from a pack label. `pnpm db:seed` never rewrites existing nutrition or
-- components, so the seed values need this migration.

UPDATE "ingredient" SET "calories" = 120, "protein" = 22.5, "carbs" = 0, "fat" = 2.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('chicken breast', 'chicken fillet', 'chicken cutlet', 'chicken tender', 'chicken strip');

UPDATE "ingredient" SET "calories" = 172.4, "protein" = 12.9, "carbs" = 0.2, "fat" = 12.9, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('chicken thigh');

UPDATE "ingredient" SET "calories" = 107.9, "protein" = 12.1, "carbs" = 0.1, "fat" = 6.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('chicken drumstick');

UPDATE "ingredient" SET "calories" = 156.2, "protein" = 12, "carbs" = 0.1, "fat" = 11.7, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('chicken leg');

UPDATE "ingredient" SET "calories" = 118.4, "protein" = 10.9, "carbs" = 0, "fat" = 8, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('chicken wing');

UPDATE "ingredient" SET "calories" = 146.2, "protein" = 12.6, "carbs" = 0, "fat" = 10.3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('whole chicken', 'poussin');

UPDATE "ingredient" SET "calories" = 114, "protein" = 23.3, "carbs" = 0, "fat" = 2.3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('turkey breast');

UPDATE "ingredient" SET "calories" = 130.4, "protein" = 15.8, "carbs" = 0, "fat" = 7.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('turkey thigh');

UPDATE "ingredient" SET "calories" = 94.5, "protein" = 13.4, "carbs" = 0, "fat" = 4.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('turkey drumstick');

UPDATE "ingredient" SET "calories" = 106.6, "protein" = 14.4, "carbs" = 0, "fat" = 5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('turkey leg');

UPDATE "ingredient" SET "calories" = 101.5, "protein" = 15.3, "carbs" = 0.1, "fat" = 4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('whole turkey');

UPDATE "ingredient" SET "calories" = 211, "protein" = 17.4, "carbs" = 0, "fat" = 15.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('duck breast', 'duck fillet');

UPDATE "ingredient" SET "calories" = 151.9, "protein" = 12.5, "carbs" = 0, "fat" = 10.9, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('duck leg');

UPDATE "ingredient" SET "calories" = 300.5, "protein" = 12.9, "carbs" = 0, "fat" = 27.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('goose');

UPDATE "ingredient" SET "calories" = 157.4, "protein" = 16.1, "carbs" = 0, "fat" = 9.9, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('quail');

UPDATE "ingredient" SET "calories" = 155.7, "protein" = 19.5, "carbs" = 0, "fat" = 8, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pheasant');

UPDATE "ingredient" SET "calories" = 131.1, "protein" = 19.4, "carbs" = 0, "fat" = 5.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('guinea fowl');

UPDATE "ingredient" SET "calories" = 215, "protein" = 18.6, "carbs" = 0, "fat" = 15, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef mince');

UPDATE "ingredient" SET "calories" = 254, "protein" = 17.2, "carbs" = 0, "fat" = 20, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef patty', 'burger patty');

UPDATE "ingredient" SET "calories" = 214, "protein" = 20, "carbs" = 0, "fat" = 14.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef steak');

UPDATE "ingredient" SET "calories" = 201, "protein" = 20.3, "carbs" = 0, "fat" = 12.7, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef sirloin', 'sirloin steak', 'beef strips');

UPDATE "ingredient" SET "calories" = 244, "protein" = 18.9, "carbs" = 0, "fat" = 18.7, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef ribeye');

UPDATE "ingredient" SET "calories" = 244, "protein" = 19.2, "carbs" = 0, "fat" = 18, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef chuck', 'beef roast', 'beef cheek');

UPDATE "ingredient" SET "calories" = 128, "protein" = 21.8, "carbs" = 0.2, "fat" = 4.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('stewing beef');

UPDATE "ingredient" SET "calories" = 251, "protein" = 18.4, "carbs" = 0, "fat" = 19.1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef brisket');

UPDATE "ingredient" SET "calories" = 155, "protein" = 21.2, "carbs" = 0, "fat" = 7.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef flank');

UPDATE "ingredient" SET "calories" = 247, "protein" = 19.6, "carbs" = 0, "fat" = 18.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef tenderloin', 'beef fillet', 'fillet steak');

UPDATE "ingredient" SET "calories" = 145, "protein" = 21.7, "carbs" = 0, "fat" = 6.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef rump', 'rump steak');

UPDATE "ingredient" SET "calories" = 125, "protein" = 23.5, "carbs" = 0, "fat" = 3.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef topside');

UPDATE "ingredient" SET "calories" = 192, "protein" = 20.7, "carbs" = 0, "fat" = 11.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef round');

UPDATE "ingredient" SET "calories" = 128, "protein" = 21.8, "carbs" = 0, "fat" = 3.9, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef shank');

UPDATE "ingredient" SET "calories" = 228, "protein" = 20.6, "carbs" = 0, "fat" = 15.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('new york strip');

UPDATE "ingredient" SET "calories" = 167.3, "protein" = 15.1, "carbs" = 0, "fat" = 11.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('t-bone steak');

UPDATE "ingredient" SET "calories" = 188, "protein" = 14, "carbs" = 0, "fat" = 14.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('beef short rib');

UPDATE "ingredient" SET "calories" = 94.1, "protein" = 11, "carbs" = 0, "fat" = 5.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('oxtail');

UPDATE "ingredient" SET "calories" = 201, "protein" = 21.1, "carbs" = 0, "fat" = 13, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pork chop', 'pork steak', 'pork cutlet', 'pork schnitzel');

UPDATE "ingredient" SET "calories" = 155, "protein" = 21.6, "carbs" = 0, "fat" = 6.9, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pork loin');

UPDATE "ingredient" SET "calories" = 109, "protein" = 21, "carbs" = 0, "fat" = 2.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pork fillet', 'pork escalope');

UPDATE "ingredient" SET "calories" = 182, "protein" = 20.3, "carbs" = 0, "fat" = 10.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pork leg');

UPDATE "ingredient" SET "calories" = 193.9, "protein" = 10.9, "carbs" = 0, "fat" = 16.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pork ribs');

UPDATE "ingredient" SET "calories" = 417, "protein" = 12.6, "carbs" = 1.3, "fat" = 39.7, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('bacon', 'smoked bacon', 'streaky bacon', 'bacon rasher', 'lardons');

UPDATE "ingredient" SET "calories" = 110, "protein" = 20.3, "carbs" = 1.3, "fat" = 2.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('back bacon');

UPDATE "ingredient" SET "calories" = 217.6, "protein" = 13.4, "carbs" = 0, "fat" = 17.8, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb chop');

UPDATE "ingredient" SET "calories" = 242.8, "protein" = 10.9, "carbs" = 0, "fat" = 21.8, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb rack', 'lamb cutlet');

UPDATE "ingredient" SET "calories" = 96.5, "protein" = 9.1, "carbs" = 0, "fat" = 6.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb shank');

UPDATE "ingredient" SET "calories" = 209, "protein" = 18.5, "carbs" = 0, "fat" = 14.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb leg');

UPDATE "ingredient" SET "calories" = 244, "protein" = 17.1, "carbs" = 0, "fat" = 19, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb shoulder');

UPDATE "ingredient" SET "calories" = 143, "protein" = 20.9, "carbs" = 0, "fat" = 5.9, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb loin', 'lamb fillet');

UPDATE "ingredient" SET "calories" = 206, "protein" = 18.6, "carbs" = 0.1, "fat" = 14.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb steak');

UPDATE "ingredient" SET "calories" = 272, "protein" = 16.9, "carbs" = 0, "fat" = 22.1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('lamb rump');

UPDATE "ingredient" SET "calories" = 117, "protein" = 21, "carbs" = 0, "fat" = 3.1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('veal', 'veal cutlet', 'veal escalope');

UPDATE "ingredient" SET "calories" = 177, "protein" = 20.1, "carbs" = 0.1, "fat" = 10.1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('veal loin');

UPDATE "ingredient" SET "calories" = 125.7, "protein" = 14.3, "carbs" = 0.1, "fat" = 7.2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('veal chop');

UPDATE "ingredient" SET "calories" = 85.8, "protein" = 12.7, "carbs" = 0, "fat" = 3.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('veal shank');

UPDATE "ingredient" SET "calories" = 120, "protein" = 23, "carbs" = 0, "fat" = 2.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('venison', 'venison steak', 'venison loin');

UPDATE "ingredient" SET "calories" = 157, "protein" = 21.8, "carbs" = 0, "fat" = 7.1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('venison mince');

UPDATE "ingredient" SET "calories" = 109, "protein" = 21.6, "carbs" = 0, "fat" = 1.8, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('bison');

UPDATE "ingredient" SET "calories" = 111, "protein" = 23, "carbs" = 0, "fat" = 1.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('elk');

UPDATE "ingredient" SET "calories" = 122, "protein" = 21.5, "carbs" = 0, "fat" = 3.3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('wild boar', 'wild boar steak');

UPDATE "ingredient" SET "calories" = 109, "protein" = 24.4, "carbs" = 0, "fat" = 0.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('tuna', 'tuna steak');

UPDATE "ingredient" SET "calories" = 84.4, "protein" = 11.9, "carbs" = 0, "fat" = 3.8, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('trout');

UPDATE "ingredient" SET "calories" = 52.4, "protein" = 9.9, "carbs" = 0, "fat" = 1.1, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('sea bass');

UPDATE "ingredient" SET "calories" = 125.1, "protein" = 11.3, "carbs" = 0, "fat" = 8.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('mackerel');

UPDATE "ingredient" SET "calories" = 59.2, "protein" = 12.6, "carbs" = 0, "fat" = 0.6, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('perch');

UPDATE "ingredient" SET "calories" = 47.5, "protein" = 10.4, "carbs" = 0, "fat" = 0.4, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pike');

UPDATE "ingredient" SET "calories" = 96.4, "protein" = 11, "carbs" = 0, "fat" = 5.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('herring');

UPDATE "ingredient" SET "calories" = 56.7, "protein" = 10.2, "carbs" = 0, "fat" = 1.5, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('sea bream');

UPDATE "ingredient" SET "calories" = 54, "protein" = 11.1, "carbs" = 0, "fat" = 0.7, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('snapper', 'red snapper');

UPDATE "ingredient" SET "calories" = 34.3, "protein" = 6.1, "carbs" = 0, "fat" = 0.9, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('flounder');

UPDATE "ingredient" SET "calories" = 91, "protein" = 18.6, "carbs" = 0, "fat" = 1.3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('halibut', 'halibut fillet', 'halibut steak');

UPDATE "ingredient" SET "calories" = 144, "protein" = 19.7, "carbs" = 0, "fat" = 6.7, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('swordfish', 'swordfish steak');

UPDATE "ingredient" SET "calories" = 97, "protein" = 18.4, "carbs" = 0, "fat" = 2, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('barramundi', 'barramundi fillet');

UPDATE "ingredient" SET "calories" = 122.8, "protein" = 13.4, "carbs" = 0, "fat" = 7.3, "fiber" = 0
WHERE "householdId" IS NULL AND "name" IN ('pork rack');

-- The boneless thigh, so a recipe can say which cut it means. The seed adds
-- its Estonian name. Inserted only where the seed has run (a global chicken
-- thigh exists), so an empty database stays empty.

INSERT INTO "ingredient" ("id", "name", "category", "subcategory", "proteinType", "defaultUnit", "allergens", "calories", "protein", "carbs", "fat", "fiber")
SELECT gen_random_uuid()::text, 'chicken thigh fillet', 'protein'::"IngredientCategory", 'poultry', 'poultry'::"ProteinType", 'g'::"Unit", '{}'::"Allergen"[], 121, 19.7, 0, 4.1, 0
WHERE EXISTS (SELECT 1 FROM "ingredient" WHERE "householdId" IS NULL AND "name" = 'chicken thigh')
  AND NOT EXISTS (SELECT 1 FROM "ingredient" WHERE "householdId" IS NULL AND "name" = 'chicken thigh fillet');

-- Library meals that mean the boneless cut (diced, stir-fried, curried, a
-- pan-fried fillet) move to the boneless row at the same amount. Meals that
-- mean the cut on the bone (roasted or braised thighs, drumsticks, wings,
-- whole fish, chops) keep the bone-in row. Matching the old amount keeps a
-- re-run and an edited meal safe.

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'chicken thigh'
  AND f."householdId" IS NULL AND f."name" = 'chicken thigh fillet'
  AND mc."quantityPerServing" = 180
  AND m."householdId" IS NULL AND m."name" IN ('Chicken Curry', 'Orange Chicken', 'Thai Basil Chicken', 'Chicken Teriyaki Bowl', 'Chicken Shawarma')
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'chicken thigh'
  AND f."householdId" IS NULL AND f."name" = 'chicken thigh fillet'
  AND mc."quantityPerServing" = 200
  AND m."householdId" IS NULL AND m."name" IN ('Chicken Korma')
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'chicken thigh'
  AND f."householdId" IS NULL AND f."name" = 'chicken thigh fillet'
  AND mc."quantityPerServing" = 150
  AND m."householdId" IS NULL AND m."name" IN ('Chicken Jambalaya')
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'trout'
  AND f."householdId" IS NULL AND f."name" = 'trout fillet'
  AND mc."quantityPerServing" = 200
  AND m."householdId" IS NULL AND m."name" IN ('Trout with Almonds')
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'lamb chop'
  AND f."householdId" IS NULL AND f."name" = 'lamb shoulder'
  AND mc."quantityPerServing" = 180
  AND m."householdId" IS NULL AND m."name" IN ('Lamb Curry')
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'lamb shank'
  AND f."householdId" IS NULL AND f."name" = 'lamb shoulder'
  AND mc."quantityPerServing" = 200
  AND m."householdId" IS NULL AND m."name" IN ('Irish Lamb Stew')
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

-- "Make it my recipe" forks (forkMeal, src/lib/meal-plans/promote-entry.ts)
-- copy a library meal's components into a household meal on the same global
-- ingredient, with no link back to the source. A fork is found by name, in
-- English or a translated name, and only at the exact old amount: a renamed
-- fork, or one the household edited, keeps its ingredient.

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'chicken thigh'
  AND f."householdId" IS NULL AND f."name" = 'chicken thigh fillet'
  AND mc."quantityPerServing" = 180
  AND m."householdId" IS NOT NULL
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Chicken Curry', 'Orange Chicken', 'Thai Basil Chicken', 'Chicken Teriyaki Bowl', 'Chicken Shawarma')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Chicken Curry', 'Orange Chicken', 'Thai Basil Chicken', 'Chicken Teriyaki Bowl', 'Chicken Shawarma')
  )
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'chicken thigh'
  AND f."householdId" IS NULL AND f."name" = 'chicken thigh fillet'
  AND mc."quantityPerServing" = 200
  AND m."householdId" IS NOT NULL
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Chicken Korma')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Chicken Korma')
  )
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'chicken thigh'
  AND f."householdId" IS NULL AND f."name" = 'chicken thigh fillet'
  AND mc."quantityPerServing" = 150
  AND m."householdId" IS NOT NULL
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Chicken Jambalaya')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Chicken Jambalaya')
  )
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'trout'
  AND f."householdId" IS NULL AND f."name" = 'trout fillet'
  AND mc."quantityPerServing" = 200
  AND m."householdId" IS NOT NULL
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Trout with Almonds')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Trout with Almonds')
  )
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'lamb chop'
  AND f."householdId" IS NULL AND f."name" = 'lamb shoulder'
  AND mc."quantityPerServing" = 180
  AND m."householdId" IS NOT NULL
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Lamb Curry')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Lamb Curry')
  )
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

UPDATE "meal_component" AS mc SET "ingredientId" = f."id"
FROM "meal" AS m, "ingredient" AS i, "ingredient" AS f
WHERE mc."mealId" = m."id" AND mc."ingredientId" = i."id"
  AND i."householdId" IS NULL AND i."name" = 'lamb shank'
  AND f."householdId" IS NULL AND f."name" = 'lamb shoulder'
  AND mc."quantityPerServing" = 200
  AND m."householdId" IS NOT NULL
  AND m."name" IN (
    SELECT g."name" FROM "meal" AS g WHERE g."householdId" IS NULL AND g."name" IN ('Irish Lamb Stew')
    UNION
    SELECT t."name" FROM "meal_translation" AS t JOIN "meal" AS g ON g."id" = t."mealId"
    WHERE g."householdId" IS NULL AND g."name" IN ('Irish Lamb Stew')
  )
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = mc."mealId" AND o."ingredientId" = f."id");

-- A planned entry's "Adjust recipe" change (a swap or a removal) names the
-- component it changes by ingredient. A change on a component this migration
-- moved would no longer match the meal and stop applying, so it follows the
-- component to the new row.

UPDATE "meal_plan_entry_component" AS c SET "originalIngredientId" = f."id"
FROM "meal_plan_entry" AS e, "meal_component" AS mc, "ingredient" AS i, "ingredient" AS f
WHERE c."entryId" = e."id" AND mc."mealId" = e."mealId" AND mc."ingredientId" = f."id"
  AND c."originalIngredientId" = i."id"
  AND i."householdId" IS NULL AND f."householdId" IS NULL
  AND (i."name", f."name") IN (('chicken thigh', 'chicken thigh fillet'), ('trout', 'trout fillet'), ('lamb chop', 'lamb shoulder'), ('lamb shank', 'lamb shoulder'))
  AND NOT EXISTS (SELECT 1 FROM "meal_component" AS o WHERE o."mealId" = e."mealId" AND o."ingredientId" = i."id");
