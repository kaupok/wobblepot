-- AlterTable
ALTER TABLE "household_member" ADD COLUMN     "name" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "member_preferences" ADD COLUMN     "allergens" "Allergen"[];
