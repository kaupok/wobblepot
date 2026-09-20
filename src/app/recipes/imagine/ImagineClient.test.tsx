import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The failure copy has to be resolved against a real catalog in a real locale;
// the global mock always answers from English, which would pass whether or not
// the leak is fixed.
vi.unmock('next-intl')
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { ImagineClient } from './ImagineClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

/** The English prose `/api/meals/imagine` puts in `data.error` on a 504. */
const SERVER_PROSE = 'Generating meal ideas took too long. Please try again.'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  )
}

function respondWith(body: Record<string, unknown>, status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    }),
  )
}

async function generate(locale: 'en' | 'et') {
  renderInLocale(<ImagineClient />, locale)
  const textarea = screen.getByRole('textbox')
  fireEvent.change(textarea, { target: { value: 'something with lentils' } })
  const label = locale === 'en' ? /imagine meals/i : /mõtle toidud välja/i
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('ImagineClient error localization', () => {
  beforeEach(() => {
    // The breadcrumb the client writes instead of rendering the server prose.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the Estonian timeout copy for a 504, not the server prose', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'imagine_timeout' }, 504)

    await generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.imagineTimeout)
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('renders the English timeout copy on the en locale', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'imagine_timeout' }, 504)

    await generate('en')

    await screen.findByText(enMessages.recipes.imagine.errors.imagineTimeout)
  })

  it('falls back to the generic translated message for an unrecognised code', async () => {
    respondWith(
      { success: false, error: 'Some brand new failure', code: 'code_from_a_newer_deploy' },
      500,
    )

    await generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.generic)
    expect(screen.queryByText('Some brand new failure')).not.toBeInTheDocument()
  })

  it('falls back to the generic translated message when the body carries no code', async () => {
    respondWith({ success: false, error: 'Failed to generate meal ideas. Please try again.' }, 500)

    await generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.generic)
  })

  it('keeps the server prose reachable as a console breadcrumb', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'imagine_timeout' }, 504)

    await generate('et')

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        '[imagine] request failed',
        expect.objectContaining({ code: 'imagine_timeout', error: SERVER_PROSE }),
      ),
    )
  })

  it('logs `message` too, where the 429 branches keep their detail', async () => {
    // On both 429s `error` is a bare label ('Rate limit exceeded', 'AI usage
    // cap exceeded') and everything actionable — the hourly limit, the
    // household-local reset date — is in `message`. Dropping it would make
    // that date visible neither to the user nor in any log.
    respondWith(
      {
        success: false,
        error: 'AI usage cap exceeded',
        code: 'ai_cap_exceeded',
        message: "You've hit this month's AI usage cap. It resets on 2026-10-01.",
        resetAt: '2026-10-01T00:00:00.000Z',
      },
      429,
    )

    await generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.aiCapExceeded)
    expect(console.error).toHaveBeenCalledWith(
      '[imagine] request failed',
      expect.objectContaining({
        code: 'ai_cap_exceeded',
        message: "You've hit this month's AI usage cap. It resets on 2026-10-01.",
      }),
    )
  })

  it('renders the translated image-cap message, with its {max} argument filled in', async () => {
    // The only coded branch whose message takes an ICU argument — a regression
    // here renders the literal `{max}` rather than the limit.
    respondWith(
      {
        success: false,
        error: `Maximum ${MAX_ATTACHED_IMAGES} images allowed`,
        code: 'too_many_images',
      },
      400,
    )

    await generate('et')

    await screen.findByText(
      etMessages.recipes.imagine.errors.tooManyImages.replace('{max}', String(MAX_ATTACHED_IMAGES)),
    )
  })
})
