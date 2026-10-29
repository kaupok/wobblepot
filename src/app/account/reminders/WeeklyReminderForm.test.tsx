import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { WeeklyReminderForm } from './WeeklyReminderForm'

// The tests render with the real catalogues, in both locales.
vi.unmock('next-intl')

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockRouterRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: mockRouterRefresh,
  }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

const settings = enMessages.household.settings
const OWNER_ONLY_NOTICE = settings.ownerOnlyNotice

const ok = () => ({ ok: true, json: () => Promise.resolve({}) })
const fail = (status: number, error: string) => ({
  ok: false,
  status,
  json: () => Promise.resolve({ error }),
})

/** The form of the section with this heading. */
function section(heading: string) {
  return screen.getByRole('form', { name: heading })
}

function renderForm(
  overrides: Partial<Parameters<typeof WeeklyReminderForm>[0]> = {},
  locale: 'en' | 'et' = 'en',
) {
  const { wrapper: QueryWrapper } = createQueryWrapper()
  const props = { weekday: null, confirmed: false, ...overrides }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={locale === 'en' ? enMessages : etMessages}>
        <QueryWrapper>{children}</QueryWrapper>
      </NextIntlClientProvider>
    )
  }
  return render(<WeeklyReminderForm {...props} />, { wrapper: Wrapper })
}

describe('WeeklyReminderForm', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockRouterRefresh.mockReset()
    // Radix Select calls pointer-capture APIs that jsdom doesn't implement.
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders one h2 at the Section size', () => {
    renderForm()

    const heading = screen.getByRole('heading', { name: 'Weekly reminder', level: 2 })
    expect(heading).toHaveClass('text-base', 'font-semibold')
  })

  it('is off by default, with no weekday select', () => {
    renderForm()

    const form = section('Weekly reminder')
    expect(within(form).getByRole('checkbox', { name: settings.reminderToggle })).not.toBeChecked()
    expect(within(form).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(form).getByRole('checkbox')).toHaveAccessibleDescription(settings.reminderHelper)
  })

  it('switches on with Sunday and saves the weekday to its own route', async () => {
    mockFetch.mockResolvedValue(ok())
    renderForm()

    const form = section('Weekly reminder')
    await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
    expect(within(form).getByRole('combobox', { name: 'Day' })).toHaveTextContent('Sunday')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/households/me/members/me/reminder',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ weekday: 7 }) }),
    )
  })

  describe('the confirm step (HON-1113)', () => {
    it('says an email is waiting while the reminder is on and the address is not confirmed', () => {
      renderForm({ weekday: 7, confirmed: false })

      const form = section('Weekly reminder')
      expect(within(form).getByText(settings.reminderAwaitingConfirm)).toBeInTheDocument()
      expect(
        within(form).getByRole('checkbox', { name: settings.reminderToggle }),
      ).toHaveAccessibleDescription(
        `${settings.reminderHelper} ${settings.reminderAwaitingConfirm}`,
      )
    })

    it.each([
      ['on and confirmed', { weekday: 7 as const, confirmed: true }],
      ['off and unconfirmed', { weekday: null, confirmed: false }],
      ['off and confirmed', { weekday: null, confirmed: true }],
    ])('says nothing about an email when %s', (_label, props) => {
      renderForm(props)

      expect(screen.queryByText(settings.reminderAwaitingConfirm)).not.toBeInTheDocument()
    })

    it('shows the line once the switch-on is saved, not on the tick', async () => {
      mockFetch.mockResolvedValue(ok())
      renderForm()

      const form = section('Weekly reminder')
      await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
      expect(within(form).queryByText(settings.reminderAwaitingConfirm)).not.toBeInTheDocument()
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      expect(await within(form).findByText(settings.reminderAwaitingConfirm)).toBeInTheDocument()
    })

    it('says the link was not sent when the route reports not_sent', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ weekday: 7, confirmEmail: 'not_sent' }),
      })
      renderForm()

      const form = section('Weekly reminder')
      await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      expect(await within(form).findByText(settings.reminderConfirmNotSent)).toBeInTheDocument()
      expect(within(form).queryByText(settings.reminderAwaitingConfirm)).not.toBeInTheDocument()
    })

    // HON-1137: an account email change drops the confirm link and sends none.
    it('says the reminder is paused after an email change, with no "we emailed you" line', () => {
      renderForm({ weekday: 7, confirmed: false, confirmLinkSent: false })

      const form = section('Weekly reminder')
      expect(within(form).getByText(settings.reminderConfirmAfterEmailChange)).toBeInTheDocument()
      expect(within(form).queryByText(settings.reminderAwaitingConfirm)).not.toBeInTheDocument()
    })

    it('says an email is waiting once a switch-on after the email change sent one', async () => {
      mockFetch.mockResolvedValueOnce(ok()).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ weekday: 7, confirmEmail: 'sent' }),
      })
      renderForm({ weekday: 7, confirmed: false, confirmLinkSent: false })

      const form = section('Weekly reminder')
      const toggle = within(form).getByRole('checkbox', { name: settings.reminderToggle })
      await userEvent.click(toggle)
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      await userEvent.click(toggle)
      await userEvent.click(await within(form).findByRole('button', { name: 'Save' }))

      expect(await within(form).findByText(settings.reminderAwaitingConfirm)).toBeInTheDocument()
      expect(
        within(form).queryByText(settings.reminderConfirmAfterEmailChange),
      ).not.toBeInTheDocument()
    })

    it('keeps the not-sent line when only the day changes after it', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ weekday: 7, confirmEmail: 'not_sent' }),
        })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ weekday: 3 }) })
      renderForm()

      const form = section('Weekly reminder')
      await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
      await within(form).findByText(settings.reminderConfirmNotSent)

      await userEvent.click(within(form).getByRole('combobox', { name: 'Day' }))
      await userEvent.click(await screen.findByRole('option', { name: 'Wednesday' }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(within(form).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument(),
      )
      expect(within(form).getByText(settings.reminderConfirmNotSent)).toBeInTheDocument()
      expect(within(form).queryByText(settings.reminderAwaitingConfirm)).not.toBeInTheDocument()
    })
  })

  it('saves another weekday picked from the select', async () => {
    mockFetch.mockResolvedValue(ok())
    renderForm({ weekday: 7 })

    const form = section('Weekly reminder')
    await userEvent.click(within(form).getByRole('combobox', { name: 'Day' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Wednesday' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me/members/me/reminder',
        expect.objectContaining({ body: JSON.stringify({ weekday: 3 }) }),
      ),
    )
  })

  it('switches off with null', async () => {
    mockFetch.mockResolvedValue(ok())
    renderForm({ weekday: 5 })

    const form = section('Weekly reminder')
    expect(within(form).getByRole('combobox', { name: 'Day' })).toHaveTextContent('Friday')
    await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
    expect(within(form).queryByRole('combobox')).not.toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/households/me/members/me/reminder',
        expect.objectContaining({ body: JSON.stringify({ weekday: null }) }),
      ),
    )
  })

  // The consent is the viewer's own, so no owner-only rule applies (HON-1084),
  // and the form has no owner to ask about (HON-1256).
  it('lets any account holder save it, with no owner-only notice', async () => {
    mockFetch.mockResolvedValue(ok())
    renderForm()

    const form = section('Weekly reminder')
    expect(within(form).queryByText(OWNER_ONLY_NOTICE)).not.toBeInTheDocument()
    const toggle = within(form).getByRole('checkbox', { name: settings.reminderToggle })
    expect(toggle).toBeEnabled()
    await userEvent.click(toggle)
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
  })

  it.each([
    [403, 'Forbidden'],
    [500, 'Failed to save the reminder'],
  ])(
    'shows the generic save failure, not the owner-only notice, on a %i',
    async (status, error) => {
      mockFetch.mockResolvedValue(fail(status, error))
      renderForm()

      const form = section('Weekly reminder')
      await userEvent.click(within(form).getByRole('checkbox', { name: settings.reminderToggle }))
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))

      expect(await within(form).findByText(settings.saveFailed)).toBeInTheDocument()
      expect(within(form).queryByText(OWNER_ONLY_NOTICE)).not.toBeInTheDocument()
    },
  )

  it('names the weekdays in the household language', () => {
    renderForm({ weekday: 7 }, 'et')

    const form = section(etMessages.household.settings.reminderHeading)
    expect(
      within(form).getByRole('combobox', {
        name: etMessages.household.settings.reminderWeekdayLabel,
      }),
    ).toHaveTextContent('Pühapäev')
  })

  // Radix only mirrors a selected item's text into a childless SelectValue
  // after mount, so the server HTML used to carry an empty trigger (HON-761).
  it('includes the weekday inside its trigger in the server render', () => {
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={new QueryClient()}>
          <WeeklyReminderForm weekday={7} confirmed />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')

    expect(doc.getElementById('reminder-weekday')?.textContent).toContain('Sunday')
  })
})
