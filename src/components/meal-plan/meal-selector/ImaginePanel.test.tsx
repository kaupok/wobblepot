import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The failure copy has to be resolved against a real catalog in a real locale;
// the global mock always answers from English, which would pass whether or not
// the leak is fixed.
vi.unmock('next-intl')
import { render, screen, fireEvent, within } from '@testing-library/react'
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
  renderInLocale(<ImaginePanel mealType="dinner" onExit={vi.fn()} onMealSaved={vi.fn()} />, locale)
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

  it('renders the kill-switch copy for a 503 generation_disabled (HON-868)', async () => {
    const prose = 'AI generation is temporarily disabled'
    respondWith({ success: false, error: prose, code: 'generation_disabled' }, 503)

    generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.generationDisabled)
    expect(screen.queryByText(prose)).not.toBeInTheDocument()
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

  it('renders the copy for a coded 429, not the server prose', async () => {
    respondWith(
      {
        success: false,
        error: 'Rate limit exceeded',
        code: 'rate_limited',
        message: 'You can imagine up to 10 meals per hour.',
      },
      429,
    )

    generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.rateLimited)
    expect(screen.queryByText('Rate limit exceeded')).not.toBeInTheDocument()
  })

  it('names the time the hourly limit lifts when the 429 carries resetAt', async () => {
    respondWith(
      {
        success: false,
        error: 'Rate limit exceeded',
        code: 'rate_limited',
        // 18:40 on the device clock, whatever TZ the test runs in.
        resetAt: new Date(2026, 9, 9, 18, 40).toISOString(),
      },
      429,
    )

    generate('et')

    await screen.findByText(
      etMessages.recipes.imagine.errors.rateLimitedUntil.replace('{time}', '18:40'),
    )
  })

  it('falls back to the imagineFailed copy when the error body is not JSON', async () => {
    // What a platform-level 502 or an HTML error page looks like to the client.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      }),
    )

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

describe('ImaginePanel prompt field name', () => {
  // getByLabelText matches aria-label but not a placeholder (HON-808).
  it.each(['en', 'et'] as const)('names the prompt textarea in %s', (locale) => {
    const messages = locale === 'en' ? enMessages : etMessages
    renderInLocale(
      <ImaginePanel mealType="dinner" onExit={vi.fn()} onMealSaved={vi.fn()} />,
      locale,
    )

    expect(
      screen.getByLabelText(messages['meal-plan'].selector.imagine.promptAria),
    ).toHaveAttribute(
      'placeholder',
      messages['meal-plan'].selector.imagine.promptPlaceholder.dinner,
    )
  })
})

describe('ImaginePanel prompt placeholder', () => {
  // An example that could never be a breakfast is a weak example (HON-944).
  it.each([
    ['en', 'breakfast', 'Something warm with oats and apple…'],
    ['en', 'lunch', 'A quick salad with eggs and something green…'],
    ['en', 'dinner', 'Something healthy with chicken and a fresh salad…'],
    ['et', 'breakfast', 'Midagi sooja kaerahelveste ja õunaga…'],
    ['et', 'lunch', 'Kiire salat muna ja millegi rohelisega…'],
    ['et', 'dinner', 'Midagi tervislikku kanaga ja värske salatiga…'],
  ] as const)('fits a %s %s slot', (locale, mealType, placeholder) => {
    renderInLocale(
      <ImaginePanel mealType={mealType} onExit={vi.fn()} onMealSaved={vi.fn()} />,
      locale,
    )

    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', placeholder)
  })
})

describe('ImaginePanel Back button', () => {
  // Opened straight in imagine there is no list to return to (HON-1247).
  it('has no Back button without onExit', () => {
    renderInLocale(<ImaginePanel mealType="dinner" onMealSaved={vi.fn()} />, 'en')

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to library' })).not.toBeInTheDocument()
  })

  it('calls onExit from the Back button', () => {
    const onExit = vi.fn()
    renderInLocale(<ImaginePanel mealType="dinner" onExit={onExit} onMealSaved={vi.fn()} />, 'en')

    fireEvent.click(screen.getByRole('button', { name: 'Back to library' }))

    expect(onExit).toHaveBeenCalledTimes(1)
  })
})

// HON-1367: the card showed the model's estimate and the review dialog the
// numbers summed from the reviewed rows, so the two disagreed on screen.
describe('ImaginePanel card nutrition', () => {
  // 360 g / 4 servings = 90 g per serving at 350 kcal per 100 g → 315 kcal.
  const idea = {
    id: 'im-1',
    name: 'Lentil soup',
    description: null,
    timeMinutes: 25,
    servings: 4,
    suitableFor: ['dinner'],
    kidFriendly: false,
    primaryProteinType: 'legume',
    components: [],
    nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
    ingredients: [
      {
        type: 'matched',
        extractedName: 'red lentils',
        extractedQuantity: 360,
        extractedUnit: 'g',
        originalText: '360 g red lentils',
        ingredient: {
          id: 'ing-lentil',
          name: 'Red lentils',
          category: 'protein',
          defaultUnit: 'g',
          gramsPerPiece: null,
          calories: 350,
          protein: 24,
          carbs: 60,
          fat: 1.5,
        },
        convertedQuantity: 360,
        isVague: false,
      },
    ],
    allMatched: true,
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The review degrades to the unreviewed meal on a failure; its rows are
    // what the dialog sums.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/api/meals/imagine'
            ? { ok: true, status: 200, json: () => Promise.resolve({ meals: [idea] }) }
            : { ok: false, status: 500, text: () => Promise.resolve('{"error":"Review failed"}') },
        ),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the dialog’s nutrition on the card after "Review and save"', async () => {
    generate('en')
    // Taken before the dialog opens: the modal hides the page from role queries.
    const heading = await screen.findByRole('heading', { name: 'Lentil soup' })
    // eslint-disable-next-line testing-library/no-node-access -- the card root has no role
    const card = heading.closest('[data-slot="card"]') as HTMLElement
    expect(within(card).getByText('480 kcal')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Review and save' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('315 kcal')).toBeInTheDocument()
    expect(within(card).getByText('315 kcal')).toBeInTheDocument()
    expect(within(card).queryByText('480 kcal')).not.toBeInTheDocument()
  })
})
