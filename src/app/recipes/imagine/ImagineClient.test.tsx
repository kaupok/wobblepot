import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The failure copy has to be resolved against a real catalog in a real locale;
// the global mock always answers from English, which would pass whether or not
// the leak is fixed.
vi.unmock('next-intl')
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import enMessages from '../../../../messages/en.json'
import etMessages from '../../../../messages/et.json'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { ImagineClient } from './ImagineClient'
import { generate, renderInLocale } from './ImagineClient.fixtures'
import { loadImagineSession, saveImagineSession } from './imagine-session'
import type { ImaginedMealResponse } from '@/lib/imagine-utils'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

/** The English prose `/api/meals/imagine` puts in `data.error` on a 504. */
const SERVER_PROSE = 'Generating meal ideas took too long. Please try again.'

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

  it('renders the kill-switch copy for a 503 generation_disabled (HON-868)', async () => {
    const prose = 'AI generation is temporarily disabled'
    respondWith({ success: false, error: prose, code: 'generation_disabled' }, 503)

    await generate('et')

    await screen.findByText(etMessages.recipes.imagine.errors.generationDisabled)
    expect(screen.queryByText(prose)).not.toBeInTheDocument()
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

    await generate('et')

    await screen.findByText(
      etMessages.recipes.imagine.errors.rateLimitedUntil.replace('{time}', '18:40'),
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

describe('ImagineClient prompt field name', () => {
  // getByLabelText matches aria-label but not a placeholder, so this fails if
  // the field is named only by its placeholder (HON-808).
  it.each(['en', 'et'] as const)('names the prompt textarea in %s', (locale) => {
    const messages = locale === 'en' ? enMessages : etMessages
    renderInLocale(<ImagineClient />, locale)

    expect(screen.getByLabelText(messages.recipes.imagine.promptAria)).toHaveAttribute(
      'placeholder',
      messages.recipes.imagine.promptPlaceholder,
    )
  })
})

describe('ImagineClient prep time (HON-891)', () => {
  const imaginedMeal = (id: string, name: string, timeMinutes: number) => ({
    id,
    name,
    description: null,
    timeMinutes,
    servings: 4,
    suitableFor: ['dinner'],
    kidFriendly: false,
    primaryProteinType: 'legume',
    components: [],
    nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
    ingredients: [],
    allMatched: true,
  })

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows each card with the prep time that will be saved, not the raw AI value', async () => {
    respondWith(
      {
        success: true,
        meals: [
          imaginedMeal('im-1', 'Lentil soup', 12.5),
          imaginedMeal('im-2', 'Slow-braised beans', 600),
        ],
      },
      200,
    )
    await generate('en')

    expect(await screen.findByText('Lentil soup')).toBeInTheDocument()
    expect(screen.getByText('13 min')).toBeInTheDocument()
    expect(screen.queryByText('12.5 min')).not.toBeInTheDocument()
    expect(screen.queryByText('600 min')).not.toBeInTheDocument()
  })
})

// The create page decides which event a save fires from the stash's `origin`
// (HON-1063): an "Edit details" save fires `meal:imagined`.
describe('ImagineClient Edit details stash', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("marks the prefilled-meal stash with origin 'imagine'", async () => {
    saveImagineSession({
      prompt: 'something with lentils',
      meals: [
        {
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
          ingredients: [],
          allMatched: true,
        } as unknown as ImaginedMealResponse,
      ],
    })
    // The quantity review degrades to the unreviewed meal on failure, which is
    // all this test needs to reach the dialog.
    respondWith({ error: 'Review failed' }, 500)
    renderInLocale(<ImagineClient />, 'en')

    fireEvent.click(await screen.findByRole('button', { name: 'Select' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }))

    expect(JSON.parse(sessionStorage.getItem('prefilled-meal')!)).toMatchObject({
      name: 'Lentil soup',
      origin: 'imagine',
      returnTo: '/recipes/imagine',
    })
  })
})

describe('ImagineClient saved ideas (HON-1270)', () => {
  const imaginedMeal = (id: string, name: string) =>
    ({
      id,
      name,
      description: null,
      timeMinutes: 25,
      servings: 4,
      suitableFor: ['dinner'],
      kidFriendly: false,
      primaryProteinType: 'legume',
      components: [],
      nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
      // A resolved ingredient, so the review dialog's Save is reachable: it
      // refuses to save a meal with no components.
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
          },
          convertedQuantity: 360,
          isVague: false,
        },
      ],
      allMatched: true,
    }) as unknown as ImaginedMealResponse

  const ideas = [
    imaginedMeal('im-1', 'Lentil soup'),
    imaginedMeal('im-2', 'Chickpea curry'),
    imaginedMeal('im-3', 'Bean chili'),
  ]

  /** The card is the heading's nearest ancestor that also holds its action. */
  const cardOf = (name: string) =>
    // eslint-disable-next-line testing-library/no-node-access -- the card root has no role
    screen.getByRole('heading', { name }).closest('[data-slot="card"]') as HTMLElement

  /**
   * The quantity review degrades to the unreviewed meal on a failure, which is
   * all the dialog needs; the recipe POST answers with `meal-123`.
   */
  function stubReviewAndSave() {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/api/households/me/meals'
            ? { ok: true, status: 201, json: () => Promise.resolve({ id: 'meal-123' }) }
            : { ok: false, status: 500, json: () => Promise.resolve({ error: 'Review failed' }) },
        ),
      ),
    )
  }

  async function saveSecondIdea() {
    saveImagineSession({ prompt: 'something with lentils', meals: ideas })
    stubReviewAndSave()
    renderInLocale(<ImagineClient />, 'en')

    const card = await waitFor(() => cardOf('Chickpea curry'))
    fireEvent.click(within(card).getByRole('button', { name: 'Select' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save recipe' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    return card
  }

  beforeEach(() => {
    sessionStorage.clear()
    push.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('marks the saved idea, links its recipe, and moves focus to the link', async () => {
    const card = await saveSecondIdea()

    expect(within(card).getByText('Saved')).toBeInTheDocument()
    const link = within(card).getByRole('link', { name: 'Open recipe' })
    expect(link).toHaveAttribute('href', '/recipes/meal-123/edit')
    expect(within(card).queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
    expect(
      within(cardOf('Lentil soup')).getByRole('button', { name: 'Select' }),
    ).toBeInTheDocument()
    expect(within(cardOf('Bean chili')).getByRole('button', { name: 'Select' })).toBeInTheDocument()
    await waitFor(() => expect(link).toHaveFocus())
  })

  it('returns focus to Select when the dialog closes without a save', async () => {
    saveImagineSession({ prompt: 'something with lentils', meals: ideas })
    stubReviewAndSave()
    renderInLocale(<ImagineClient />, 'en')

    const card = await waitFor(() => cardOf('Chickpea curry'))
    const select = within(card).getByRole('button', { name: 'Select' })
    fireEvent.click(select)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(select).toHaveFocus())
    expect(within(card).queryByText('Saved')).not.toBeInTheDocument()
  })

  it('writes the saved recipe ID into the stash', async () => {
    await saveSecondIdea()

    expect(loadImagineSession()?.savedMealIds).toEqual({ 'im-2': 'meal-123' })
  })

  it('gives the save toast an "Open recipe" action to the recipe', async () => {
    const success = vi.spyOn(toast, 'success')
    await saveSecondIdea()

    expect(success).toHaveBeenCalledWith('Recipe saved to your library', {
      action: expect.objectContaining({ label: 'Open recipe' }),
    })
    const [, options] = success.mock.calls[0]!
    const action = options?.action as unknown as { onClick: () => void }
    action.onClick()
    expect(push).toHaveBeenCalledWith('/recipes/meal-123/edit')
  })

  it('restores the saved state from the stash on mount', async () => {
    saveImagineSession({
      prompt: 'something with lentils',
      meals: ideas,
      savedMealIds: { 'im-2': 'meal-123' },
    })
    renderInLocale(<ImagineClient />, 'en')

    const card = await waitFor(() => cardOf('Chickpea curry'))
    expect(within(card).getByText('Saved')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open recipe' })).toHaveAttribute(
      'href',
      '/recipes/meal-123/edit',
    )
    expect(within(card).queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
  })

  it('shows Select on every card of a new run', async () => {
    saveImagineSession({
      prompt: 'something with lentils',
      meals: ideas,
      savedMealIds: { 'im-1': 'meal-1', 'im-2': 'meal-2', 'im-3': 'meal-3' },
    })
    renderInLocale(<ImagineClient />, 'en')
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Open recipe' })).toHaveLength(3),
    )

    respondWith(
      { success: true, meals: [imaginedMeal('im-1', 'Pea soup'), imaginedMeal('im-2', 'Dal')] },
      200,
    )
    fireEvent.click(screen.getByRole('button', { name: /imagine meals/i }))

    expect(await screen.findByText('Pea soup')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Select' })).toHaveLength(2)
    expect(screen.queryByRole('link', { name: 'Open recipe' })).not.toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })
})
