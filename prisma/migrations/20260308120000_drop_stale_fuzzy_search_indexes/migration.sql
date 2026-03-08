-- Drop GIN trigram indexes that are no longer used
DROP INDEX IF EXISTS idx_ingredient_name_trgm;
DROP INDEX IF EXISTS idx_meal_name_trgm;
