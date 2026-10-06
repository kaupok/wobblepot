import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSession } from '@/lib/session'
import { listConfirmedWaitlistRequests } from '@/lib/waitlist'
import AdminWaitlistPage, { generateMetadata } from './page'

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/waitlist', () => ({
  listConfirmedWaitlistRequests: vi.fn(),
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
describe('AdminWaitlistPage generateMetadata', () => {
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

  it('returns the English title, unindexed, for the admin', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionFor('admin@example.com'))

    await expect(generateMetadata()).resolves.toEqual({
      title: 'Waitlist',
      robots: { index: false, follow: false },
    })
  })
})

describe('AdminWaitlistPage', () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset()
    vi.mocked(listConfirmedWaitlistRequests).mockReset()
  })

  it('calls notFound for anyone but the admin and reads no requests', async () => {
    for (const session of [null, sessionFor('someone@example.com')]) {
      vi.mocked(getSession).mockResolvedValue(session)
      await expect(AdminWaitlistPage()).rejects.toThrow('NEXT_NOT_FOUND')
    }
    expect(listConfirmedWaitlistRequests).not.toHaveBeenCalled()
  })

  it('loads the confirmed requests for the admin', async () => {
    vi.mocked(getSession).mockResolvedValue(sessionFor('admin@example.com'))
    vi.mocked(listConfirmedWaitlistRequests).mockResolvedValue([])

    await AdminWaitlistPage()

    expect(listConfirmedWaitlistRequests).toHaveBeenCalledTimes(1)
  })
})
