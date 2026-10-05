-- HON-1040: an entry without a `servingOverride` now cooks for the household's
-- servings, its members' portions summed (`sumPortions`), not its member count.
-- Prep tips cached before this change were priced at the member count, and the
-- tips route serves any cached tips, so a household of two adults and a 0.5x
-- child would keep tips for 3 servings beside a card that says 2.5.
--
-- Clear the rows `invalidateFutureEntryTips` would clear, for the households
-- whose servings differ from their member count. The rest priced at the right
-- number already, and each cleared row costs a paid regeneration on its next
-- open. The `date` bound runs one day early because entries are date-only and
-- the household's timezone is not applied here; an entry a day in the past is
-- never read again, so clearing it costs nothing.
--
-- `sumPortions` is: the portions summed (no preferences row counts as 1),
-- rounded to the nearest 0.5, at least 1. The `numeric` cast matters: on
-- `float8` Postgres rounds a half to even, so 2.25 would round to 2 instead of
-- `Math.round`'s 2.5.
UPDATE "meal_plan_entry" AS e
SET "preparationTips" = NULL
FROM "meal_plan" AS p
WHERE e."planId" = p."id"
  AND e."servingOverride" IS NULL
  AND e."preparationTips" IS NOT NULL
  AND e."status" <> 'completed'
  AND e."date" >= CURRENT_DATE - INTERVAL '1 day'
  AND p."householdId" IN (
    SELECT m."householdId"
    FROM "household_member" AS m
    LEFT JOIN "member_preferences" AS mp ON mp."memberId" = m."id"
    GROUP BY m."householdId"
    HAVING GREATEST(1, ROUND(SUM(COALESCE(mp."portionMultiplier", 1))::numeric * 2) / 2) <> COUNT(*)
  );
