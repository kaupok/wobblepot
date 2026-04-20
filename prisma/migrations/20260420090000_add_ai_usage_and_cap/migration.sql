-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('plan_generate', 'plan_fill_empty', 'meal_imagine', 'meal_review_quantities', 'recipe_parse', 'entry_suggestions', 'entry_preparation_tips', 'entry_regenerate');

-- AlterTable
ALTER TABLE "household" ADD COLUMN "aiCapUsd" DECIMAL(10,4) NOT NULL DEFAULT 5.00;

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "feature" "AiFeature" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "estimatedCostUsd" DECIMAL(10,6) NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_householdId_createdAt_idx" ON "ai_usage"("householdId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
