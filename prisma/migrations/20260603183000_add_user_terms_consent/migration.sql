-- Versioned Terms/Privacy consent captured at sign-up (HON-457).
-- Both columns nullable: pre-policy users remain valid rows.
ALTER TABLE "user" ADD COLUMN "acceptedTermsAt" TIMESTAMP(3),
ADD COLUMN "acceptedTermsVersion" INTEGER;
