import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Atomicity contract: the unique index on `code` plus the row-level UPDATE
// predicate in `validateAndClaimInviteCode` are what prevent double-use under
// concurrent sign-ups. If a future migration drops or weakens the unique
// indexes, the contract silently breaks — this regression guard catches it.
describe('migration 20260425200000_add_signup_code', () => {
  const sql = readFileSync(join(__dirname, 'migration.sql'), 'utf-8')

  it('creates the signup_code table with the load-bearing columns', () => {
    expect(sql).toMatch(/CREATE TABLE "signup_code"/)
    expect(sql).toMatch(/"code" TEXT NOT NULL/)
    expect(sql).toMatch(/"usedAt" TIMESTAMP\(3\)/)
    expect(sql).toMatch(/"expiresAt" TIMESTAMP\(3\)/)
  })

  it('creates a unique index on code (atomic claim relies on this)', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX "signup_code_code_key" ON "signup_code"\("code"\)/)
  })

  it('creates a unique index on usedById (one user per code)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "signup_code_usedById_key" ON "signup_code"\("usedById"\)/,
    )
  })

  it('creates the foreign-key index for createdById', () => {
    expect(sql).toMatch(
      /CREATE INDEX "signup_code_createdById_idx" ON "signup_code"\("createdById"\)/,
    )
  })

  it('attaches both FKs to user with ON DELETE SET NULL (audit trail survives user deletion)', () => {
    expect(sql).toMatch(/signup_code_createdById_fkey.*ON DELETE SET NULL/s)
    expect(sql).toMatch(/signup_code_usedById_fkey.*ON DELETE SET NULL/s)
  })
})
