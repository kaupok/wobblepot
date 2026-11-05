-- Side dishes (HON-1608). A side is a meal plan entry that points at its
-- slot's main through `mainEntryId`, and is deleted with it. The one-entry-
-- per-slot index now counts mains only. `meal.course` is a hint for the
-- suggestion pools; every existing meal stays `main`. No row changes.
-- CreateEnum
CREATE TYPE "MealCourse" AS ENUM ('main', 'side');

-- DropIndex
DROP INDEX "meal_plan_entry_planId_date_mealType_key";

-- AlterTable
ALTER TABLE "meal" ADD COLUMN     "course" "MealCourse" NOT NULL DEFAULT 'main';

-- AlterTable
ALTER TABLE "meal_plan_entry" ADD COLUMN     "mainEntryId" TEXT;

-- CreateIndex
CREATE INDEX "meal_plan_entry_mainEntryId_idx" ON "meal_plan_entry"("mainEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_entry_planId_date_mealType_key" ON "meal_plan_entry"("planId", "date", "mealType") WHERE ("mainEntryId" IS NULL);

-- AddForeignKey
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_mainEntryId_fkey" FOREIGN KEY ("mainEntryId") REFERENCES "meal_plan_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

