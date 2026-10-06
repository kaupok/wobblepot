import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import ConfirmInviteRequestPage, { generateMetadata } from './page'
import { confirmWaitlistToken } from '@/lib/waitlist'

let translationLocale: 'en' | 'et' = 'en'

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({
        locale: translationLocale,
        messages: (translationLocale === 'et' ? etMessages : enMessages) as never,
        namespace: namespace as never,
      }),
    ),
  }
})

vi.mock('@/lib/waitlist', () => ({
  confirmWaitlistToken: vi.fn(),
}))

const mockConfirm = vi.mocked(confirmWaitlistToken)

async function renderPage(searchParams: { token?: string | string[] }) {
  render(await ConfirmInviteRequestPage({ searchParams: Promise.resolve(searchParams) }))
}

describe('/request-invite/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    translationLocale = 'en'
  })

  it('confirms a valid token and says the visitor is on the list', async () => {
    mockConfirm.mockResolvedValue(true)

    await renderPage({ token: 'tok' })

    expect(mockConfirm).toHaveBeenCalledWith('tok')
    expect(
      screen.getByRole('heading', { level: 1, name: "You're on the list" }),
    ).toBeInTheDocument()
    expect(screen.getByText('We email an invite when a place opens.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ask again' })).not.toBeInTheDocument()
  })

  it('shows the expired page, with a way to ask again, for an expired or used token', async () => {
    mockConfirm.mockResolvedValue(false)

    await renderPage({ token: 'old' })

    expect(
      screen.getByRole('heading', { level: 1, name: 'This link has expired or was used' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ask again' })).toHaveAttribute(
      'href',
      '/request-invite',
    )
  })

  it.each([
    ['no token', {}],
    ['a repeated token parameter', { token: ['a', 'b'] }],
  ])('treats %s as expired', async (_label, searchParams) => {
    mockConfirm.mockResolvedValue(false)

    await renderPage(searchParams)

    expect(mockConfirm).toHaveBeenCalledWith(undefined)
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link has expired or was used' }),
    ).toBeInTheDocument()
  })

  it('renders both outcomes in Estonian', async () => {
    translationLocale = 'et'
    mockConfirm.mockResolvedValueOnce(true)
    await renderPage({ token: 'tok' })
    expect(screen.getByRole('heading', { level: 1, name: 'Oled nimekirjas' })).toBeInTheDocument()

    mockConfirm.mockResolvedValueOnce(false)
    await renderPage({ token: 'old' })
    expect(screen.getByRole('link', { name: 'Küsi uuesti' })).toHaveAttribute(
      'href',
      '/request-invite',
    )
  })

  it('keeps the token URL out of search indexes', async () => {
    expect(await generateMetadata()).toEqual({
      title: 'Invite request',
      robots: { index: false, follow: false },
    })
  })
})
