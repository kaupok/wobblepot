-- CreateEnum
CREATE TYPE "MealImageStatus" AS ENUM ('none', 'generating', 'ready', 'failed');

-- AlterTable
ALTER TABLE "meal" ADD COLUMN     "imageAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "imageClaimedAt" TIMESTAMP(3),
ADD COLUMN     "imagePromptVersion" TEXT,
ADD COLUMN     "imageStatus" "MealImageStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "imageUrl" TEXT;
