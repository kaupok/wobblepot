import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import ConfirmReminderPage, { generateMetadata } from './page'
import { reminderConfirmState } from '@/lib/weekly-reminder'

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
  reminderConfirmState: vi.fn(),
  REMINDER_CONFIRM_TTL_DAYS: 7,
}))

// The form is a client component with its own test; here only which branch renders.
vi.mock('./ConfirmReminderForm', () => ({
  ConfirmReminderForm: ({ token }: { token: string }) => (
    <div data-testid="confirm-form">{token}</div>
  ),
}))

const mockState = vi.mocked(reminderConfirmState)

async function renderPage(searchParams: { token?: string | string[] }) {
  render(await ConfirmReminderPage({ searchParams: Promise.resolve(searchParams) }))
}

describe('/reminders/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    translationLocale = 'en'
  })

  it('renders the button for a pending token, without confirming anything on open', async () => {
    mockState.mockResolvedValue('pending')

    await renderPage({ token: 'tok' })

    expect(mockState).toHaveBeenCalledWith('tok')
    expect(screen.getByTestId('confirm-form')).toHaveTextContent('tok')
  })

  it('says the reminder is on for a token that was already confirmed', async () => {
    mockState.mockResolvedValue('confirmed')

    await renderPage({ token: 'tok' })

    expect(screen.queryByTestId('confirm-form')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'The weekly reminder is on' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Household page' })).toHaveAttribute(
      'href',
      '/household',
    )
  })

  it('shows the expired page, with the way to a new link, for an expired token', async () => {
    mockState.mockResolvedValue('expired')

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
    mockState.mockResolvedValue('expired')

    await renderPage(searchParams)

    expect(mockState).toHaveBeenCalledWith(undefined)
    expect(screen.queryByTestId('confirm-form')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeInTheDocument()
  })

  it('renders both outcomes in Estonian', async () => {
    translationLocale = 'et'
    mockState.mockResolvedValueOnce('confirmed')
    await renderPage({ token: 'tok' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Iganädalane meeldetuletus on sees' }),
    ).toBeInTheDocument()

    mockState.mockResolvedValueOnce('expired')
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
