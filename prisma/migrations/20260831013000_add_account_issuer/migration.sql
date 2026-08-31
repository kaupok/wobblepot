-- AlterTable: Better Auth 1.7 adds a required `issuer` column to `account`
-- and makes (issuer, accountId) the identity key, replacing
-- (providerId, accountId). Providers without an issuer of their own get a
-- synthetic issuer — see `createLocalAccountIssuer` in @better-auth/core,
-- which builds `local:` + encodeURIComponent(providerId). This app is
-- email/password only (zero plugins, no OAuth), so the only provider is
-- `credential`, which URL-encodes to itself; the concatenation below is
-- therefore exact, and every existing row backfills to `local:credential`.
--
-- Added nullable → backfilled → set NOT NULL so existing rows survive.
ALTER TABLE "account" ADD COLUMN "issuer" TEXT;

UPDATE "account" SET "issuer" = 'local:' || "providerId" WHERE "issuer" IS NULL;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

-- Deploy-window guard: migrations land before code (docs/DEPLOYMENT.md:50,94),
-- so the still-running Better Auth 1.5.4 client keeps INSERTing into `account`
-- without `issuer` until the new build is live — a NOT NULL column with no
-- default would 500 every sign-up for that whole window, and indefinitely if
-- the code were rolled back. `local:credential` is not a placeholder: it is
-- the only issuer this app can produce, so the default is always the value
-- the old code would have written.
ALTER TABLE "account" ALTER COLUMN "issuer" SET DEFAULT 'local:credential';

-- DropIndex / CreateIndex: the account identity key moves from providerId to
-- issuer. Dropping first keeps the table with exactly one identity constraint,
-- matching what Better Auth 1.7 declares for the model.
DROP INDEX "account_providerId_accountId_key";

CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");
