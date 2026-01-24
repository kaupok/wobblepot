-- AlterTable
ALTER TABLE "meal_component" ADD COLUMN     "isVague" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalPhrase" TEXT;
