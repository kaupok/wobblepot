-- CreateTable
CREATE TABLE "meal_preparation_steps" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "servings" INTEGER NOT NULL,
    "steps" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_preparation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meal_preparation_steps_mealId_locale_key" ON "meal_preparation_steps"("mealId", "locale");

-- AddForeignKey
ALTER TABLE "meal_preparation_steps" ADD CONSTRAINT "meal_preparation_steps_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "meal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
