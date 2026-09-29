import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSession } from '@/lib/session'
import { generateMetadata } from './page'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => (key === 'title' ? 'Signup codes' : key)),
}))

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

type Session = Awaited<ReturnType<typeof getSession>>
const sessionFor = (email: string): Session => ({ user: { email } }) as never

// Metadata resolves separately from the layout's and page's `notFound()`, so
// it must gate itself or the 404 renders under the admin title (HON-830).
// ADMIN_EMAIL is admin@example.com via vitest.config.ts.
describe('AdminSignupCodesPage generateMetadata', () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset()
  })

  it('calls notFound for a signed-in non-admin', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionFor('someone@example.com'))

    await expect(generateMetadata()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('calls notFound when signed out', async () => {
    vi.mocked(getSession).mockResolvedValue(null)

    await expect(generateMetadata()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('returns the page title, unindexed, for the admin', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionFor('admin@example.com'))

    await expect(generateMetadata()).resolves.toEqual({
      title: 'Signup codes',
      robots: { index: false, follow: false },
    })
  })
})
