-- AlterTable: the link an invite request came from, from `?ref=` on
-- /request-invite (HON-1089). Null when the link had no valid ref.
ALTER TABLE "waitlist_request" ADD COLUMN "source" TEXT;
