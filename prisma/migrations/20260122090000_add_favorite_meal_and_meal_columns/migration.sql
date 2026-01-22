-- AlterTable
ALTER TABLE "meal" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "meal" ADD COLUMN IF NOT EXISTS "servings" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE IF NOT EXISTS "favorite_meal" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_meal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "favorite_meal_householdId_mealId_key" ON "favorite_meal"("householdId", "mealId");

-- AddForeignKey
ALTER TABLE "favorite_meal" DROP CONSTRAINT IF EXISTS "favorite_meal_householdId_fkey";
ALTER TABLE "favorite_meal" ADD CONSTRAINT "favorite_meal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_meal" DROP CONSTRAINT IF EXISTS "favorite_meal_mealId_fkey";
ALTER TABLE "favorite_meal" ADD CONSTRAINT "favorite_meal_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
