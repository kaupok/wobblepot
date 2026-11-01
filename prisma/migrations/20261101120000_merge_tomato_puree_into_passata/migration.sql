-- HON-1551: merge the global `tomato puree` row into `passata`. US tomato
-- purée is a thicker passata, so the two are one product in practice, and no
-- seeded recipe uses `tomato puree`. Its Estonian name "tomatipüree" is what an
-- Estonian shop calls the concentrate (`tomato paste`, "tomatipasta"), so a
-- shopper who followed it bought a sauce twice as strong.
--
-- The SQL is the HON-1500 merge (20261031120000_merge_shared_estonian_name_twins)
-- with one pair; its header lists what each step moves. The survivor keeps its
-- own nutrition values. Both rows are g, but the unit handling stays so the SQL
-- is safe on a database whose rows have drifted.
--
-- Global rows only (householdId IS NULL): a household's own row is its data.
-- A missing row on either side (a fresh CI or Neon branch, or a second run)
-- changes nothing.

DO $$
DECLARE
  pair   TEXT[];
  dup    "ingredient"%ROWTYPE;
  kept   "ingredient"%ROWTYPE;
  factor DOUBLE PRECISION;
  merged RECORD;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['tomato puree', 'passata']
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
      RAISE EXCEPTION 'HON-1551: cannot convert % (%) to % (%): no gramsPerPiece',
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
