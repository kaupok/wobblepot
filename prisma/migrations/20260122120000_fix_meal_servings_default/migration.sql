-- Fix meal.servings default value to match schema (4 instead of 1)
-- This migration documents the change that was made directly to the database
ALTER TABLE "meal" ALTER COLUMN "servings" SET DEFAULT 4;
