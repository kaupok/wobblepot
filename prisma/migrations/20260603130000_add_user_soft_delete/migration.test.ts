import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Soft-delete contract (HON-481): the daily purge cron scans
// `WHERE purgeScheduledFor < now()`. The index on that column is load-bearing
// for that scan, and both timestamps MUST stay nullable so existing/active
// accounts are never marked for deletion. If a future migration drops the
// index or makes a column NOT NULL, this regression guard catches it.
describe('migration 20260603130000_add_user_soft_delete', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')

  it('adds both soft-delete columns to the user table', () => {
    expect(sql).toMatch(/ALTER TABLE "user" ADD COLUMN "deletedAt" TIMESTAMP\(3\)/)
    expect(sql).toMatch(/ADD COLUMN "purgeScheduledFor" TIMESTAMP\(3\)/)
  })

  it('keeps both columns nullable (no NOT NULL on the new columns)', () => {
    expect(sql).not.toMatch(/"deletedAt" TIMESTAMP\(3\) NOT NULL/)
    expect(sql).not.toMatch(/"purgeScheduledFor" TIMESTAMP\(3\) NOT NULL/)
  })

  it('creates the index the purge cron scan relies on', () => {
    expect(sql).toMatch(
      /CREATE INDEX "user_purgeScheduledFor_idx" ON "user"\("purgeScheduledFor"\)/,
    )
  })
})
