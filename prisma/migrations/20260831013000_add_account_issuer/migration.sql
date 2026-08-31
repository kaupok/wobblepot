-- AlterTable: Better Auth 1.7 adds a required `issuer` column to `account`
-- and makes (issuer, accountId) the identity key, replacing
-- (providerId, accountId). Providers without an issuer of their own get a
-- synthetic `local:<urlencoded providerId>` — see
-- @better-auth/core `createLocalAccountIssuer`. This app is email/password
-- only (zero plugins, no OAuth), so every existing row backfills to
-- `local:credential`.
--
-- Added nullable → backfilled → set NOT NULL so existing rows survive.
ALTER TABLE "account" ADD COLUMN "issuer" TEXT;

UPDATE "account" SET "issuer" = 'local:' || "providerId" WHERE "issuer" IS NULL;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

-- DropIndex / CreateIndex: the account identity key moves from providerId to
-- issuer. Dropping first keeps the table with exactly one identity constraint,
-- matching what Better Auth 1.7 declares for the model.
DROP INDEX "account_providerId_accountId_key";

CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");
