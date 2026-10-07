-- AlterTable: the opt-in weekly planning reminder email (HON-1084). Consent
-- belongs to the person who receives the email, so it is stored per member.
ALTER TABLE "household_member" ADD COLUMN "reminderWeekday" INTEGER,
ADD COLUMN "reminderConsentAt" TIMESTAMP(3),
ADD COLUMN "reminderToken" TEXT,
ADD COLUMN "reminderLastSentAt" TIMESTAMP(3);

-- CreateIndex: the stop link looks the member up by its token.
CREATE UNIQUE INDEX "household_member_reminderToken_key" ON "household_member"("reminderToken");
