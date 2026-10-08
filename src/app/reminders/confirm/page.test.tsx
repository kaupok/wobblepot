import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import ConfirmReminderPage, { generateMetadata } from './page'
import { confirmReminderToken } from '@/lib/weekly-reminder'

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

vi.mock('@/lib/weekly-reminder', () => ({
  confirmReminderToken: vi.fn(),
  REMINDER_CONFIRM_TTL_DAYS: 7,
}))

const mockConfirm = vi.mocked(confirmReminderToken)

async function renderPage(searchParams: { token?: string | string[] }) {
  render(await ConfirmReminderPage({ searchParams: Promise.resolve(searchParams) }))
}

describe('/reminders/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    translationLocale = 'en'
  })

  it('confirms a valid token and says the reminder is on', async () => {
    mockConfirm.mockResolvedValue(true)

    await renderPage({ token: 'tok' })

    expect(mockConfirm).toHaveBeenCalledWith('tok')
    expect(
      screen.getByRole('heading', { level: 1, name: 'The weekly reminder is on' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Household page' })).toHaveAttribute(
      'href',
      '/household',
    )
  })

  it('shows the expired page, with the way to a new link, for a token that does not confirm', async () => {
    mockConfirm.mockResolvedValue(false)

    await renderPage({ token: 'old' })

    expect(
      screen.getByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/The link works for 7 days, and only while the reminder is on\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Household page' })).toHaveAttribute(
      'href',
      '/household',
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
      screen.getByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeInTheDocument()
  })

  it('renders both outcomes in Estonian', async () => {
    translationLocale = 'et'
    mockConfirm.mockResolvedValueOnce(true)
    await renderPage({ token: 'tok' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Iganädalane meeldetuletus on sees' }),
    ).toBeInTheDocument()

    mockConfirm.mockResolvedValueOnce(false)
    await renderPage({ token: 'old' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'See link on aegunud' }),
    ).toBeInTheDocument()
  })

  it('keeps the token URL out of search indexes', async () => {
    expect(await generateMetadata()).toEqual({
      title: 'Confirm the weekly reminder',
      robots: { index: false, follow: false },
    })
  })
})
