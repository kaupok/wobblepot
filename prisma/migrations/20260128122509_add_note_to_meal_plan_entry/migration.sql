-- DropIndex
DROP INDEX "idx_ingredient_name_trgm";

-- DropIndex
DROP INDEX "idx_meal_name_trgm";

-- AlterTable
ALTER TABLE "meal_plan_entry" ADD COLUMN     "note" TEXT;
