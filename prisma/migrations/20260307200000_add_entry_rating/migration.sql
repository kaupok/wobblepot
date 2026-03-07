-- CreateEnum
CREATE TYPE "EntryRating" AS ENUM ('up', 'down');

-- AlterTable
ALTER TABLE "meal_plan_entry" ADD COLUMN "rating" "EntryRating";
