-- A leftover item also keeps its words when its source is a fridge meal
-- (HON-1440). A dinner made into a fridge meal keeps its lunches with
-- `mealId` NULL (HON-1394), so the cascade dropped the lunch's item and left
-- an empty card whose Undo failed. The item now becomes free text with the
-- name the source's card showed (FridgeMealCard, HON-1412): its leftovers'
-- meal names when it has leftovers, otherwise every item's text, joined with
-- ", " in item order, first letter in capitals, in the household's language.
-- A source with no name to give keeps the cascade, as before. A recipe source
-- keeps the meal's name, as in 20261028150000_leftover_item_servings.
CREATE OR REPLACE FUNCTION "keep_fridge_leftover_items"() RETURNS trigger AS $$
DECLARE
  "householdLocale" TEXT;
  "sourceName" TEXT;
BEGIN
  SELECT h."locale" INTO "householdLocale"
    FROM "meal_plan" p
    JOIN "household" h ON h."id" = p."householdId"
   WHERE p."id" = OLD."planId";

  IF OLD."mealId" IS NOT NULL THEN
    "sourceName" := COALESCE(
      (SELECT mt."name" FROM "meal_translation" mt
        WHERE mt."mealId" = OLD."mealId" AND mt."locale" = "householdLocale"),
      (SELECT m."name" FROM "meal" m WHERE m."id" = OLD."mealId"));
  ELSE
    -- Leftovers lead: their meals are the card's name.
    SELECT string_agg(COALESCE(
             i."label",
             (SELECT mt."name" FROM "meal_translation" mt
               WHERE mt."mealId" = s."mealId" AND mt."locale" = "householdLocale"),
             m."name"), ', ' ORDER BY i."position")
      INTO "sourceName"
      FROM "meal_plan_entry_item" i
      JOIN "meal_plan_entry" s ON s."id" = i."sourceEntryId"
      LEFT JOIN "meal" m ON m."id" = s."mealId"
     WHERE i."entryId" = OLD."id";

    IF "sourceName" IS NULL THEN
      SELECT string_agg(COALESCE(
               i."label",
               (SELECT it."name" FROM "ingredient_translation" it
                 WHERE it."ingredientId" = i."ingredientId" AND it."locale" = "householdLocale"),
               g."name"), ', ' ORDER BY i."position")
        INTO "sourceName"
        FROM "meal_plan_entry_item" i
        LEFT JOIN "ingredient" g ON g."id" = i."ingredientId"
       WHERE i."entryId" = OLD."id";
    END IF;

    "sourceName" := upper(left("sourceName", 1)) || substr("sourceName", 2);
  END IF;

  IF "sourceName" <> '' THEN
    UPDATE "meal_plan_entry_item"
    SET "label" = LEFT("sourceName", 80),
        "sourceEntryId" = NULL,
        "servings" = NULL
    WHERE "sourceEntryId" = OLD."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
