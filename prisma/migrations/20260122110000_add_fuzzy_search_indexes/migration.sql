-- Enable pg_trgm extension for trigram-based fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add GIN indexes for efficient trigram searches
-- These indexes support the % (similarity) operator and similarity() function
CREATE INDEX idx_ingredient_name_trgm ON "ingredient" USING GIN (name gin_trgm_ops);
CREATE INDEX idx_meal_name_trgm ON "meal" USING GIN (name gin_trgm_ops);
