-- HON-1097: merge each American global ingredient into the British global row
-- that already exists beside it. HON-1083 renamed rows in place; these 16 could
-- not be renamed, because the British name is taken and the rename would fail
-- on `ingredient_global_name_key` (docs/RUNBOOKS/translation-maintenance.md →
-- "Renaming a seeded ingredient or meal").
--
-- For each pair the American row's references move to the British row, then
-- the American row is deleted:
--
-- * meal_component: quantities are stored in the ingredient's defaultUnit, so
--   they are converted when the two rows differ (the chilli pairs: g → piece).
--   A meal that holds both rows keeps the British component and gains the
--   American quantity (unique key mealId + ingredientId).
-- * pantry_item: a household that holds both keeps its British item (unique
--   key householdId + ingredientId).
-- * custom_shopping_item: repointed; no unique key on the ingredient.
-- * household_preferences / member_preferences."excludedIngredientIds": ids
--   with no foreign key, so a household's exclusion would otherwise point at a
--   deleted row and stop filtering.
-- * The British row gains any allergen or protein type only the American row
--   had, so no allergen filter is lost in the merge.
--
-- Global rows only (householdId IS NULL): a household's own row is its data.
-- A pair whose American row is absent (a fresh CI or Neon branch, or a second
-- run) changes nothing. A pair whose British row is absent renames the American
-- row in place; that is how `fresh cilantro` becomes `fresh coriander` before
-- `cilantro` merges into it.

DO $$
DECLARE
  pair   TEXT[];
  am     "ingredient"%ROWTYPE;
  br     "ingredient"%ROWTYPE;
  factor DOUBLE PRECISION;
  merged RECORD;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    -- Rename in place first: no British twin exists.
    ['fresh cilantro', 'fresh coriander'],
    ['cilantro', 'fresh coriander'],
    ['shrimp', 'prawns'],
    ['pork tenderloin', 'pork fillet'],
    ['heavy cream', 'double cream'],
    ['ground lamb', 'lamb mince'],
    ['ground pork', 'pork mince'],
    ['ground turkey', 'turkey mince'],
    ['ground chicken', 'chicken mince'],
    ['beet', 'beetroot'],
    ['lima beans', 'butter beans'],
    ['chicken broth', 'chicken stock'],
    ['beef broth', 'beef stock'],
    ['vegetable broth', 'vegetable stock'],
    ['green chili pepper', 'green chilli'],
    ['red chili pepper', 'red chilli'],
    ['beef stew meat', 'stewing beef']
  ]
  LOOP
    SELECT * INTO am FROM "ingredient"
    WHERE "name" = pair[1] AND "householdId" IS NULL;
    CONTINUE WHEN NOT FOUND;

    SELECT * INTO br FROM "ingredient"
    WHERE "name" = pair[2] AND "householdId" IS NULL;
    IF NOT FOUND THEN
      UPDATE "ingredient" SET "name" = pair[2] WHERE "id" = am."id";
      CONTINUE;
    END IF;

    -- One American unit in British units. NULL when a piece weight is missing.
    factor := CASE
      WHEN am."defaultUnit" = br."defaultUnit" THEN 1
      WHEN am."defaultUnit" = 'g' AND br."defaultUnit" = 'piece' AND br."gramsPerPiece" > 0
        THEN 1 / br."gramsPerPiece"
      WHEN am."defaultUnit" = 'piece' AND br."defaultUnit" = 'g' AND am."gramsPerPiece" > 0
        THEN am."gramsPerPiece"
    END;

    UPDATE "ingredient"
    SET "allergens" = ARRAY(
          SELECT DISTINCT a FROM unnest(br."allergens" || am."allergens") AS a ORDER BY a
        ),
        "proteinType" = COALESCE(br."proteinType", am."proteinType")
    WHERE "id" = br."id";

    -- A meal that holds both rows: keep the British component.
    FOR merged IN
      SELECT a."id" AS am_component, b."id" AS br_component, a."mealId", a."quantityPerServing"
      FROM "meal_component" a
      JOIN "meal_component" b ON b."mealId" = a."mealId" AND b."ingredientId" = br."id"
      WHERE a."ingredientId" = am."id"
    LOOP
      IF factor IS NOT NULL THEN
        UPDATE "meal_component"
        SET "quantityPerServing" = "quantityPerServing" + merged."quantityPerServing" * factor,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = merged.br_component;
      ELSE
        RAISE NOTICE 'HON-1097: meal % holds % and % with no unit conversion; kept %',
          merged."mealId", pair[1], pair[2], pair[2];
      END IF;
      DELETE FROM "meal_component" WHERE "id" = merged.am_component;
    END LOOP;

    IF factor IS NULL AND EXISTS (SELECT 1 FROM "meal_component" WHERE "ingredientId" = am."id") THEN
      RAISE EXCEPTION 'HON-1097: cannot convert % (%) to % (%): no gramsPerPiece',
        pair[1], am."defaultUnit", pair[2], br."defaultUnit";
    END IF;

    UPDATE "meal_component"
    SET "ingredientId" = br."id",
        "quantityPerServing" = "quantityPerServing" * factor,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "ingredientId" = am."id";

    -- A household that holds both: keep the British item, add the American
    -- amount to it, keep a staple flag set on either, and keep the earlier
    -- expiry. An untracked amount (NULL) on either side, or no conversion,
    -- leaves the British amount as it is.
    UPDATE "pantry_item" b
    SET "quantity" = COALESCE(b."quantity" + a."quantity" * factor, b."quantity"),
        "isStaple" = b."isStaple" OR a."isStaple",
        "expiresAt" = LEAST(b."expiresAt", a."expiresAt"),
        "updatedAt" = CURRENT_TIMESTAMP
    FROM "pantry_item" a
    WHERE a."ingredientId" = am."id"
      AND b."ingredientId" = br."id"
      AND b."householdId" = a."householdId";

    DELETE FROM "pantry_item" a
    USING "pantry_item" b
    WHERE a."ingredientId" = am."id"
      AND b."ingredientId" = br."id"
      AND b."householdId" = a."householdId";

    -- With no conversion the amount is unknown: NULL is "not tracked".
    UPDATE "pantry_item"
    SET "ingredientId" = br."id",
        "quantity" = "quantity" * factor,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "ingredientId" = am."id";

    UPDATE "custom_shopping_item"
    SET "ingredientId" = br."id"
    WHERE "ingredientId" = am."id";

    UPDATE "household_preferences"
    SET "excludedIngredientIds" = ARRAY(
      SELECT DISTINCT unnest(array_replace("excludedIngredientIds", am."id", br."id"))
    )
    WHERE am."id" = ANY("excludedIngredientIds");

    UPDATE "member_preferences"
    SET "excludedIngredientIds" = ARRAY(
      SELECT DISTINCT unnest(array_replace("excludedIngredientIds", am."id", br."id"))
    ),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE am."id" = ANY("excludedIngredientIds");

    DELETE FROM "ingredient_translation" WHERE "ingredientId" = am."id";
    DELETE FROM "ingredient" WHERE "id" = am."id";
  END LOOP;
END $$;
