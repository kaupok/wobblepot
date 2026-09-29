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
import { createQueryWrapper } from '@/test/query-wrapper'
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
  const { wrapper: Wrapper } = createQueryWrapper()
  render(
    <Wrapper>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Tallinn">
        <FirstTimeSetup userName="Kaupo" />
      </NextIntlClientProvider>
    </Wrapper>,
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

  it('renders the generic copy for a network failure, and a timeout copy for an abort', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    clickGenerate('et')
    await screen.findByText(etErrors.generic)

    // Retrying clears the previous error while the new request runs.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('The operation was aborted.', 'AbortError'))),
    )
    fireEvent.click(screen.getByRole('button', { name: etMessages['meal-plan'].firstTime.submit }))
    await screen.findByText(etErrors.generationTimeout)
    expect(screen.queryByText(etErrors.generic)).not.toBeInTheDocument()
  })
})

// The first-run state is still Today, so it carries Today's page title
// (HON-815): one h1, hidden, ahead of the welcome h2 and the h3 groups.
describe('FirstTimeSetup outline', () => {
  it.each([
    ['en', enMessages],
    ['et', etMessages],
  ] as const)('opens with one hidden h1 in %s', (locale, messages) => {
    const { wrapper: Wrapper } = createQueryWrapper()
    const { container } = render(
      <Wrapper>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Tallinn">
          <FirstTimeSetup userName="Kaupo" />
        </NextIntlClientProvider>
      </Wrapper>,
    )

    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(messages.today.pageTitle)
    expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBe(h1s[0])
    expect(container.querySelector('h2')).toBeInTheDocument()
    expect(h1s[0]?.parentElement).toHaveClass('sr-only')
  })
})
