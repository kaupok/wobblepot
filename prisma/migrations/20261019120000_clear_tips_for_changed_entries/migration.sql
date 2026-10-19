-- HON-1254: steps cached for an entry with ingredient changes were generated
-- by a prompt that let the meal's name override the changed list, so they can
-- name an ingredient the household left out. The cache guard pins the inputs,
-- not the prompt text, so clear them; a planned entry regenerates on open.
UPDATE "meal_plan_entry"
SET "preparationTips" = NULL
WHERE "preparationTips" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "meal_plan_entry_component" c
    WHERE c."entryId" = "meal_plan_entry"."id"
  );
