import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The global next-intl mock in vitest.setup.ts resolves every key against the
// English catalog, so it cannot tell a translated string from an untranslated
// one — which is the entire bug under test here (HON-725). Use the real
// provider so the `et` assertions below are meaningful.
vi.unmock('next-intl')
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { FirstTimeSetup } from './FirstTimeSetup'

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

function clickGenerate(locale: 'en' | 'et') {
  const messages = locale === 'et' ? etMessages : enMessages
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Tallinn">
      <FirstTimeSetup userName="Kaupo" />
    </NextIntlClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: messages['meal-plan'].firstTime.submit }))
}

describe('FirstTimeSetup error localization', () => {
  beforeEach(() => {
    // The breadcrumb the component writes instead of rendering the server prose.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the Estonian insufficient-candidates copy, never the planner prose', async () => {
    // Raw `InsufficientCandidatesError.message`, passed through by the route.
    const prose = 'No fish meals available matching household dietary constraints'
    respondWith(
      { code: 'insufficient_candidates', error: 'Insufficient meal options', message: prose },
      422,
    )

    clickGenerate('et')

    await screen.findByText(etErrors.insufficientCandidates)
    expect(screen.queryByText(prose)).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith(
      '[first-time-setup] request failed',
      expect.objectContaining({ code: 'insufficient_candidates' }),
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

    clickGenerate('et')

    await screen.findByText(etErrors.generationDisabled)
    expect(screen.queryByText(prose)).not.toBeInTheDocument()
  })

  it('distinguishes the monthly AI cap from the hourly rate limit', async () => {
    const prose = "You've hit this month's AI usage cap. It resets on 2026-05-01."
    respondWith({ code: 'ai_cap_exceeded', error: 'AI usage cap exceeded', message: prose }, 429)

    clickGenerate('et')

    await screen.findByText(etErrors.aiCapExceeded)
    expect(screen.queryByText(prose)).not.toBeInTheDocument()
  })

  it('falls back to the generic generation-failed copy for an unrecognised code', async () => {
    respondWith({ code: 'some_future_code', message: 'Something new went wrong.' }, 400)

    clickGenerate('et')

    await screen.findByText(etErrors.generationFailed)
    expect(screen.queryByText('Something new went wrong.')).not.toBeInTheDocument()
  })

  it('falls back on the status for a 504 with no code (a platform timeout)', async () => {
    respondWith({}, 504)

    clickGenerate('et')

    await screen.findByText(etErrors.generationTimeout)
  })
})
