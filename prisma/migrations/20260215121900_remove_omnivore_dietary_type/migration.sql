-- Convert existing 'omnivore' values to NULL (no preference)
UPDATE "household_preferences" SET "dietaryType" = NULL WHERE "dietaryType" = 'omnivore';
UPDATE "member_preferences" SET "dietaryType" = NULL WHERE "dietaryType" = 'omnivore';

-- Remove 'omnivore' from the DietaryType enum
-- PostgreSQL requires creating a new enum, migrating columns, and dropping the old one
ALTER TYPE "DietaryType" RENAME TO "DietaryType_old";
CREATE TYPE "DietaryType" AS ENUM ('vegetarian', 'vegan', 'pescatarian');
ALTER TABLE "household_preferences" ALTER COLUMN "dietaryType" TYPE "DietaryType" USING ("dietaryType"::text::"DietaryType");
ALTER TABLE "member_preferences" ALTER COLUMN "dietaryType" TYPE "DietaryType" USING ("dietaryType"::text::"DietaryType");
DROP TYPE "DietaryType_old";
