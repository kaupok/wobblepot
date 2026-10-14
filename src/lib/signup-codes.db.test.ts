import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createSignupCode,
  deleteUnusedSignupCode,
  listSignupCodes,
  mintE2eSignupCode,
  revokeSignupCode,
  SignupCodeError,
  type SignupCodeRefusal,
} from '@/lib/signup-codes'

// Runs against PGlite through the `unit-db` project (HON-1186), with no mocks.

const createUser = (id: string) =>
  prisma.user.create({ data: { id, name: id, email: `${id}@example.com` } })

async function refusalOf(promise: Promise<unknown>): Promise<SignupCodeRefusal> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof SignupCodeError)) throw new Error(`Expected a refusal, got ${error}`)
  return error.reason
}

describe('createSignupCode', () => {
  it('mints an unused 12-character code with the note and its creator', async () => {
    await createUser('admin')

    const row = await createSignupCode({ createdById: 'admin', note: 'For Anna' })

    expect(row).toMatchObject({
      note: 'For Anna',
      usedAt: null,
      expiresAt: null,
      usedByEmail: null,
    })
    expect(row.code).toMatch(/^[\w-]{12}$/)
    const stored = await prisma.signupCode.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored).toMatchObject({ code: row.code, createdById: 'admin', note: 'For Anna' })
    expect(row.createdAt).toBe(stored.createdAt.toISOString())
  })

  it('mints a different code each time', async () => {
    await createUser('admin')

    const first = await createSignupCode({ createdById: 'admin', note: null })
    const second = await createSignupCode({ createdById: 'admin', note: null })

    expect(first.code).not.toBe(second.code)
  })
})

describe('listSignupCodes', () => {
  it('lists codes newest first, and reports a used code as used with its user', async () => {
    await createUser('anna')
    await prisma.signupCode.create({
      data: {
        id: 'old',
        code: 'old-code',
        createdAt: new Date('2026-04-25T12:00:00Z'),
        usedAt: new Date('2026-04-26T08:00:00Z'),
        usedById: 'anna',
        note: 'For Anna',
      },
    })
    await prisma.signupCode.create({
      data: {
        id: 'new',
        code: 'new-code',
        createdAt: new Date('2026-04-27T12:00:00Z'),
        expiresAt: new Date('2026-05-11T12:00:00Z'),
      },
    })

    expect(await listSignupCodes()).toEqual([
      {
        id: 'new',
        code: 'new-code',
        createdAt: '2026-04-27T12:00:00.000Z',
        usedAt: null,
        expiresAt: '2026-05-11T12:00:00.000Z',
        note: null,
        usedByEmail: null,
      },
      {
        id: 'old',
        code: 'old-code',
        createdAt: '2026-04-25T12:00:00.000Z',
        usedAt: '2026-04-26T08:00:00.000Z',
        expiresAt: null,
        note: 'For Anna',
        usedByEmail: 'anna@example.com',
      },
    ])
  })

  it('lists the newest 100 codes only', async () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    await prisma.signupCode.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({
        code: `code-${i}`,
        createdAt: new Date(start + i * 1000),
      })),
    })

    const codes = await listSignupCodes()

    expect(codes).toHaveLength(100)
    expect(codes[0]!.code).toBe('code-100')
    expect(codes.map((c) => c.code)).not.toContain('code-0')
  })
})

describe('revokeSignupCode', () => {
  it('deletes an unused code', async () => {
    await prisma.signupCode.create({ data: { id: 'c1', code: 'unused' } })

    await revokeSignupCode('c1')

    expect(await prisma.signupCode.count()).toBe(0)
  })

  it('refuses a used code and keeps it', async () => {
    await prisma.signupCode.create({ data: { id: 'c1', code: 'used', usedAt: new Date() } })

    expect(await refusalOf(revokeSignupCode('c1'))).toBe('alreadyUsed')
    expect(await prisma.signupCode.count()).toBe(1)
  })

  it('refuses an unknown code', async () => {
    expect(await refusalOf(revokeSignupCode('missing'))).toBe('notFound')
  })
})

describe('E2E seed codes', () => {
  it('mints an unused code with the e2e- prefix', async () => {
    const code = await mintE2eSignupCode()

    expect(code).toMatch(/^e2e-\d+-[a-z0-9]+$/)
    const stored = await prisma.signupCode.findUniqueOrThrow({ where: { code } })
    expect(stored).toMatchObject({ usedAt: null, expiresAt: null, createdById: null })
  })

  it('deletes an unused code by its value and counts it', async () => {
    const code = await mintE2eSignupCode()

    expect(await deleteUnusedSignupCode(code)).toBe(1)
    expect(await prisma.signupCode.count()).toBe(0)
  })

  it('keeps a used code, because it records who signed up with it', async () => {
    await prisma.signupCode.create({ data: { code: 'e2e-used', usedAt: new Date() } })

    expect(await deleteUnusedSignupCode('e2e-used')).toBe(0)
    expect(await prisma.signupCode.count()).toBe(1)
  })
})
