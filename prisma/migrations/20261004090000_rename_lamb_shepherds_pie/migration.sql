-- HON-1046: the lamb seed meal was named 'Shepherd s Pie', distinct from the
-- beef "Shepherd's Pie" only by a missing apostrophe. Both slugify to
-- `shepherd-s-pie`, so the global image batch skipped both. `pnpm db:seed`
-- matches a global meal by name, so the seed rename needs the row renamed in
-- place first (docs/RUNBOOKS/translation-maintenance.md → "Renaming a seeded
-- ingredient or meal"). Same id, so components, plan entries, favourites and
-- the et translation follow it.
--
-- Only the global row (householdId IS NULL) is touched: a household's copy is
-- the household's own data. Matching on the old name makes a second run, or a
-- fresh database that never had the row, change nothing. The image columns
-- are left alone: the row has no image, and the description is unchanged.
UPDATE "meal"
SET "name" = 'Lamb Shepherd''s Pie',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Shepherd s Pie'
  AND "householdId" IS NULL;
