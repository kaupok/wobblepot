-- AlterTable: the weekly reminder's double opt-in (HON-1113). The cron sends
-- only once the member has opened the confirm link sent to their address.
ALTER TABLE "household_member" ADD COLUMN "reminderConfirmToken" TEXT,
ADD COLUMN "reminderConfirmedAt" TIMESTAMP(3);

-- CreateIndex: the confirm link looks the member up by its token.
CREATE UNIQUE INDEX "household_member_reminderConfirmToken_key" ON "household_member"("reminderConfirmToken");

-- Backfill: members who opted in before the confirm step keep the reminder.
-- They are the invited first cohort, whose addresses the admin knows.
UPDATE "household_member" SET "reminderConfirmedAt" = "reminderConsentAt" WHERE "reminderConsentAt" IS NOT NULL;
