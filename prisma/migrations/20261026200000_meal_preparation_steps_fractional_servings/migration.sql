-- HON-1338: a household recipe's steps are cached at the household's servings,
-- which are its members' portions summed and can be a fraction such as 2.5
-- (HON-1040). Widening INTEGER to DOUBLE PRECISION keeps every library row's
-- value, so no row goes stale.
ALTER TABLE "meal_preparation_steps" ALTER COLUMN "servings" SET DATA TYPE DOUBLE PRECISION;
