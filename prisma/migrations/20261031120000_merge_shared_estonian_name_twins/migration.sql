-- HON-1500: merge each global ingredient that shares its Estonian name with a
-- row for the same food (`oats` and `rolled oats` are both "kaerahelbed") into
-- that row. HON-1481 renamed the pairs that are different foods; these 18 are
-- one food under two English names, so an Estonian household saw the name
-- twice in the ingredient picker and a recipe line could land on either row.
--
-- The survivor keeps its own nutrition values. The steps follow HON-1097
-- (20261007120000_merge_british_ingredient_twins), plus the three tables
-- HON-1243 and the day extras added since, whose foreign keys cascade:
--
-- * meal_component: quantities are stored in the ingredient's defaultUnit, so
--   they are converted when the two rows differ. A meal that holds both rows
--   keeps the survivor's component and gains the other quantity (unique key
--   mealId + ingredientId).
-- * pantry_item: a household that holds both keeps the survivor's item
--   (unique key householdId + ingredientId).
-- * custom_shopping_item: repointed; no unique key on the ingredient.
-- * meal_plan_entry_component, meal_plan_entry_item, day_extra: repointed.
--   They cascade on delete, so without this the delete would remove a
--   household's change to a planned meal, a fridge item or a day extra.
-- * household_preferences."excludedIngredientIds": ids
--   with no foreign key, so an exclusion would otherwise point at a deleted
--   row and stop filtering.
-- * The survivor gains any allergen or protein type only the other row had,
--   so no allergen filter is lost in the merge.
--
-- Every pair is g to g with the same allergens today; the generic handling
-- stays so the SQL is safe on a database whose rows have drifted.
--
-- Global rows only (householdId IS NULL): a household's own row is its data.
-- A pair whose removed row or survivor is absent (a fresh CI or Neon branch,
-- or a second run) changes nothing.

DO $$
DECLARE
  pair   TEXT[];
  dup    "ingredient"%ROWTYPE;
  kept   "ingredient"%ROWTYPE;
  factor DOUBLE PRECISION;
  merged RECORD;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['oats', 'rolled oats'],
    ['calamari', 'squid'],
    ['chicken fillet', 'chicken breast'],
    ['gai lan', 'chinese broccoli'],
    ['five spice powder', 'chinese five spice'],
    ['jalapeno', 'jalapeño'],
    ['dashima', 'kombu'],
    ['sliced almonds', 'flaked almonds'],
    ['dover sole', 'sole'],
    ['dover sole fillet', 'sole fillet'],
    ['purple cabbage', 'red cabbage'],
    ['snap peas', 'sugar snap peas'],
    ['thai sweet basil', 'thai basil'],
    ['crawfish', 'crayfish'],
    ['chèvre', 'goat''s cheese'],
    ['haricot beans', 'white beans'],
    ['great northern beans', 'white beans'],
    ['desiccated coconut', 'coconut flakes']
  ]
  LOOP
    SELECT * INTO dup FROM "ingredient"
    WHERE "name" = pair[1] AND "householdId" IS NULL;
    CONTINUE WHEN NOT FOUND;

    SELECT * INTO kept FROM "ingredient"
    WHERE "name" = pair[2] AND "householdId" IS NULL;
    CONTINUE WHEN NOT FOUND;

    -- One unit of the removed row in the survivor's unit. NULL when a piece
    -- weight is missing.
    factor := CASE
      WHEN dup."defaultUnit" = kept."defaultUnit" THEN 1
      WHEN dup."defaultUnit" = 'g' AND kept."defaultUnit" = 'piece' AND kept."gramsPerPiece" > 0
        THEN 1 / kept."gramsPerPiece"
      WHEN dup."defaultUnit" = 'piece' AND kept."defaultUnit" = 'g' AND dup."gramsPerPiece" > 0
        THEN dup."gramsPerPiece"
    END;

    IF factor IS NULL AND (
      EXISTS (SELECT 1 FROM "meal_component" WHERE "ingredientId" = dup."id")
      OR EXISTS (SELECT 1 FROM "meal_plan_entry_component"
                 WHERE "replacementIngredientId" = dup."id" AND "quantityPerServing" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "day_extra"
                 WHERE "ingredientId" = dup."id" AND "quantity" IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'HON-1500: cannot convert % (%) to % (%): no gramsPerPiece',
        pair[1], dup."defaultUnit", pair[2], kept."defaultUnit";
    END IF;

    UPDATE "ingredient"
    SET "allergens" = ARRAY(
          SELECT DISTINCT a FROM unnest(kept."allergens" || dup."allergens") AS a ORDER BY a
        ),
        "proteinType" = COALESCE(kept."proteinType", dup."proteinType")
    WHERE "id" = kept."id";

    -- A meal that holds both rows: keep the survivor's component.
    FOR merged IN
      SELECT a."id" AS dup_component, b."id" AS kept_component, a."quantityPerServing"
      FROM "meal_component" a
      JOIN "meal_component" b ON b."mealId" = a."mealId" AND b."ingredientId" = kept."id"
      WHERE a."ingredientId" = dup."id"
    LOOP
      UPDATE "meal_component"
      SET "quantityPerServing" = "quantityPerServing" + merged."quantityPerServing" * factor,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = merged.kept_component;
      DELETE FROM "meal_component" WHERE "id" = merged.dup_component;
    END LOOP;

    UPDATE "meal_component"
    SET "ingredientId" = kept."id",
        "quantityPerServing" = "quantityPerServing" * factor,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "ingredientId" = dup."id";

    -- A household that holds both: keep the survivor's item, add the other
    -- amount to it, keep a staple flag set on either, and keep the earlier
    -- expiry. An untracked amount (NULL) on either side, or no conversion,
    -- leaves the survivor's amount as it is.
    UPDATE "pantry_item" b
    SET "quantity" = COALESCE(b."quantity" + a."quantity" * factor, b."quantity"),
        "isStaple" = b."isStaple" OR a."isStaple",
        "expiresAt" = LEAST(b."expiresAt", a."expiresAt"),
        "updatedAt" = CURRENT_TIMESTAMP
    FROM "pantry_item" a
    WHERE a."ingredientId" = dup."id"
      AND b."ingredientId" = kept."id"
      AND b."householdId" = a."householdId";

    DELETE FROM "pantry_item" a
    USING "pantry_item" b
    WHERE a."ingredientId" = dup."id"
      AND b."ingredientId" = kept."id"
      AND b."householdId" = a."householdId";

    -- With no conversion the amount is unknown: NULL is "not tracked".
    UPDATE "pantry_item"
    SET "ingredientId" = kept."id",
        "quantity" = "quantity" * factor,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "ingredientId" = dup."id";

    UPDATE "custom_shopping_item"
    SET "ingredientId" = kept."id"
    WHERE "ingredientId" = dup."id";

    UPDATE "meal_plan_entry_component"
    SET "originalIngredientId" = kept."id"
    WHERE "originalIngredientId" = dup."id";

    -- The quantity is stored in the replacement's defaultUnit.
    UPDATE "meal_plan_entry_component"
    SET "replacementIngredientId" = kept."id",
        "quantityPerServing" = "quantityPerServing" * factor
    WHERE "replacementIngredientId" = dup."id";

    UPDATE "meal_plan_entry_item"
    SET "ingredientId" = kept."id"
    WHERE "ingredientId" = dup."id";

    UPDATE "day_extra"
    SET "ingredientId" = kept."id",
        "quantity" = "quantity" * factor
    WHERE "ingredientId" = dup."id";

    UPDATE "household_preferences"
    SET "excludedIngredientIds" = ARRAY(
      SELECT DISTINCT unnest(array_replace("excludedIngredientIds", dup."id", kept."id"))
    )
    WHERE dup."id" = ANY("excludedIngredientIds");

    DELETE FROM "ingredient_translation" WHERE "ingredientId" = dup."id";
    DELETE FROM "ingredient" WHERE "id" = dup."id";
  END LOOP;
END $$;
