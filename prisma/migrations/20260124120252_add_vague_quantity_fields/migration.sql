-- DropIndex
DROP INDEX "idx_ingredient_name_trgm";

-- DropIndex
DROP INDEX "idx_meal_name_trgm";

-- AlterTable
ALTER TABLE "meal_component" ADD COLUMN     "isVague" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalPhrase" TEXT;
