import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveEmailLocale } from './locale'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    householdMember: {
      findFirst: vi.fn(),
    },
  },
}))

const findFirst = vi.mocked(prisma.householdMember.findFirst)

describe('resolveEmailLocale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns the household's locale when it is public", async () => {
    findFirst.mockResolvedValue({ household: { locale: 'et' } } as never)

    await expect(resolveEmailLocale('user-1')).resolves.toBe('et')
  })

  it('falls back to English for a user with no household', async () => {
    findFirst.mockResolvedValue(null as never)

    await expect(resolveEmailLocale('user-without-household')).resolves.toBe('en')
  })

  // A new account has no household yet; the sign-up verification mail passes
  // the visitor's Accept-Language match (HON-1155).
  it('uses the given fallback for a user with no household', async () => {
    findFirst.mockResolvedValue(null as never)

    await expect(resolveEmailLocale('new-user', 'et')).resolves.toBe('et')
  })

  it('prefers the household locale over the fallback', async () => {
    findFirst.mockResolvedValue({ household: { locale: 'en' } } as never)

    await expect(resolveEmailLocale('user-1', 'et')).resolves.toBe('en')
  })

  it('falls back to English for an unrecognised or retired locale', async () => {
    findFirst.mockResolvedValue({ household: { locale: 'de' } } as never)

    await expect(resolveEmailLocale('user-1')).resolves.toBe('en')
  })

  it('falls back to English when the household locale is empty', async () => {
    findFirst.mockResolvedValue({ household: { locale: '' } } as never)

    await expect(resolveEmailLocale('user-1')).resolves.toBe('en')
  })

  it('falls back to English rather than throwing when the lookup fails', async () => {
    // Both call sites are best-effort sends — `sendResetPassword` in particular
    // must not surface an error that distinguishes an existing account.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    findFirst.mockRejectedValue(new Error('connection lost'))

    await expect(resolveEmailLocale('user-1')).resolves.toBe('en')
    expect(consoleError).toHaveBeenCalled()
  })

  it('reads only the household locale for the given user', async () => {
    findFirst.mockResolvedValue({ household: { locale: 'en' } } as never)

    await resolveEmailLocale('user-42')

    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-42' },
      select: { household: { select: { locale: true } } },
    })
  })
})
