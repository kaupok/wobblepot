-- AlterTable: Add memberId field and change default maxUses to 1
ALTER TABLE "household_invite" ADD COLUMN "memberId" TEXT;

-- AlterTable: Change default maxUses from null to 1 for member-specific invites
ALTER TABLE "household_invite" ALTER COLUMN "maxUses" SET DEFAULT 1;

-- CreateIndex: Ensure only one invite per member
CREATE UNIQUE INDEX "household_invite_memberId_key" ON "household_invite"("memberId");

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "household_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Delete existing general invites (they're being deprecated)
DELETE FROM "household_invite" WHERE "memberId" IS NULL;
