-- Optional expiry for read-only API keys (HON-1221). Additive only: a null
-- `expiresAt` is a key that does not expire, so every existing key keeps working.

-- AlterTable
ALTER TABLE "api_key" ADD COLUMN "expiresAt" TIMESTAMP(3);
