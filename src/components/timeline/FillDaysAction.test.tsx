import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock in vitest.setup.ts resolves every key against the
// English catalog, so it cannot tell a translated string from an untranslated
// one — which is the entire bug under test here (HON-725). Use the real
// provider so the `et` assertions below are meaningful.
vi.unmock('next-intl')
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { FillDaysAction } from './FillDaysAction'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

const etErrors = etMessages['meal-plan'].errors

function respondWith(body: unknown, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) })),
  )
}

function clickFill(locale: 'en' | 'et') {
  const messages = locale === 'et' ? etMessages : enMessages
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Tallinn">
        <FillDaysAction planId="plan-1" startDate="2026-04-16" />
      </NextIntlClientProvider>
    </Wrapper>,
  )
  fireEvent.click(screen.getByRole('button', { name: messages['meal-plan'].fillDays.submit }))
}

describe('FillDaysAction error localization', () => {
  beforeEach(() => {
    // The breadcrumb the component writes instead of rendering the server prose.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the Estonian no-empty-slots copy, never the server prose', async () => {
    respondWith(
      {
        code: 'no_empty_slots',
        error: 'No empty slots to fill',
        message: 'No empty slots to fill',
      },
      400,
    )

    clickFill('et')

    await screen.findByText(etErrors.noEmptySlots)
    expect(screen.queryByText('No empty slots to fill')).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith(
      '[fill-days] request failed',
      expect.objectContaining({ code: 'no_empty_slots' }),
    )
  })

  it('renders the Estonian kill-switch copy for generation_disabled', async () => {
    const prose = 'AI plan generation is currently turned off. Please try again later.'
    respondWith(
      {
        code: 'generation_disabled',
        error: 'AI generation is temporarily disabled',
        message: prose,
      },
      503,
    )

    clickFill('et')

    await screen.findByText(etErrors.generationDisabled)
    expect(screen.queryByText(prose)).not.toBeInTheDocument()
  })

  it('distinguishes the monthly AI cap from the hourly rate limit', async () => {
    const prose = "You've hit this month's AI usage cap. It resets on 2026-05-01."
    respondWith({ code: 'ai_cap_exceeded', error: 'AI usage cap exceeded', message: prose }, 429)

    clickFill('et')

    await screen.findByText(etErrors.aiCapExceeded)
    expect(screen.queryByText(prose)).not.toBeInTheDocument()
  })

  it('names the time the hourly limit lifts when the 429 carries resetAt', async () => {
    respondWith(
      {
        code: 'rate_limited',
        error: 'Rate limit exceeded',
        // 18:40 on the device clock, whatever TZ the test runs in.
        resetAt: new Date(2026, 9, 9, 18, 40).toISOString(),
      },
      429,
    )

    clickFill('et')

    await screen.findByText(etErrors.rateLimitUntil.replace('{time}', '18:40'))
  })

  it('keeps the plain rate-limit copy when the 429 has no resetAt', async () => {
    respondWith({ code: 'rate_limited', error: 'Rate limit exceeded' }, 429)

    clickFill('et')

    await screen.findByText(etErrors.rateLimit)
  })

  it('falls back to the generic generation-failed copy for an unrecognised code', async () => {
    respondWith({ code: 'some_future_code', message: 'Something new went wrong.' }, 400)

    clickFill('et')

    await screen.findByText(etErrors.generationFailed)
    expect(screen.queryByText('Something new went wrong.')).not.toBeInTheDocument()
  })

  it('falls back on the status for a 504 with no code (a platform timeout)', async () => {
    respondWith({}, 504)

    clickFill('et')

    await screen.findByText(etErrors.generationTimeout)
  })
})

// The refresh can unmount the bar, so the page moves focus once it lands
// (HON-1139).
describe('FillDaysAction onFilled', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderWith(onFilled: (startDate: string) => void) {
    const { wrapper: Wrapper } = createQueryWrapper()
    render(
      <Wrapper>
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="Europe/Tallinn">
          <FillDaysAction planId="plan-1" startDate="2026-04-16" onFilled={onFilled} />
        </NextIntlClientProvider>
      </Wrapper>,
    )
    fireEvent.click(screen.getByRole('button', { name: enMessages['meal-plan'].fillDays.submit }))
  }

  it('reports the start date once the fill succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'plan-1' }) }),
      ),
    )
    const onFilled = vi.fn()

    renderWith(onFilled)

    await waitFor(() => expect(onFilled).toHaveBeenCalledWith('2026-04-16'))
  })

  it('does not report a failed fill', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    respondWith({ code: 'generation_failed', error: 'Failed' }, 500)
    const onFilled = vi.fn()

    renderWith(onFilled)

    await screen.findByText(enMessages['meal-plan'].errors.generationFailed)
    expect(onFilled).not.toHaveBeenCalled()
  })
})
