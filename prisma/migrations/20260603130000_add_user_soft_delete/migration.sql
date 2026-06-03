-- AlterTable: GDPR Art. 17 soft-delete (HON-481).
-- `deletedAt` non-null marks a deletion request (sign-in is blocked while set);
-- `purgeScheduledFor` is when the daily cron hard-cascades the account
-- (request time + 30 days). Both nullable so existing rows are untouched.
ALTER TABLE "user" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "purgeScheduledFor" TIMESTAMP(3);

-- CreateIndex: the daily purge cron scans `WHERE purgeScheduledFor < now()`.
CREATE INDEX "user_purgeScheduledFor_idx" ON "user"("purgeScheduledFor");
