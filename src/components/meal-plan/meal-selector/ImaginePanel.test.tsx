import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The failure copy has to be resolved against a real catalog in a real locale;
// the global mock always answers from English, which would pass whether or not
// the leak is fixed.
vi.unmock('next-intl')
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { createQueryWrapper } from '@/test/query-wrapper'
import { ImaginePanel } from './ImaginePanel'

/** The English prose `/api/meals/imagine` puts in `data.error` on a 504. */
const SERVER_PROSE = 'Generating meal ideas took too long. Please try again.'

function renderInLocale(node: ReactNode, locale: 'en' | 'et') {
  const messages = locale === 'en' ? enMessages : etMessages
  const { wrapper: QueryWrapper } = createQueryWrapper()
  return render(
    <QueryWrapper>
      <NextIntlClientProvider locale={locale} messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryWrapper>,
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

function generate(locale: 'en' | 'et') {
  renderInLocale(<ImaginePanel onExit={vi.fn()} onMealSaved={vi.fn()} />, locale)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'something with lentils' } })
  const label = locale === 'en' ? /imagine meals/i : /mõtle toidud välja/i
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('ImaginePanel error localization', () => {
  beforeEach(() => {
    // The breadcrumb the panel writes instead of rendering the server prose.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the Estonian timeout copy for a 504, not the server prose', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'imagine_timeout' }, 504)

    generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.imagineTimeout)
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('renders the English timeout copy on the en locale', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'imagine_timeout' }, 504)

    generate('en')

    await screen.findByText(enMessages.recipes.imagine.errors.imagineTimeout)
  })

  it('falls back to the panel’s own generic message for an unrecognised code', async () => {
    respondWith(
      { success: false, error: 'Some brand new failure', code: 'code_from_a_newer_deploy' },
      500,
    )

    generate('et')

    // The panel's fallback resolves against `recipes.imagine.errors`, whose
    // `imagineFailed` is the same string as its own `meal-plan` namespace copy.
    await screen.findByText(etMessages.recipes.imagine.errors.imagineFailed)
    expect(screen.queryByText('Some brand new failure')).not.toBeInTheDocument()
  })

  it('falls back to the generic translated message when the body carries no code', async () => {
    respondWith({ success: false, error: 'Failed to generate meal ideas. Please try again.' }, 500)

    generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.imagineFailed)
  })

  it('keeps the server prose reachable as a console breadcrumb', async () => {
    respondWith({ success: false, error: SERVER_PROSE, code: 'imagine_timeout' }, 504)

    generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.imagineTimeout)
    expect(console.error).toHaveBeenCalledWith(
      '[imagine] request failed',
      expect.objectContaining({ code: 'imagine_timeout', error: SERVER_PROSE }),
    )
  })
})
