import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MealFormData } from '@/components/household/MealForm'
import { track } from '@/lib/analytics'
import { CreateRecipeClient } from './CreateRecipeClient'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('prefilled=true'),
}))

// The form itself is covered by `MealForm`'s own tests and stories; this suite
// is about which route Cancel/Save lands on and what they clear, so the form is
// reduced to the two callbacks that drive those decisions, plus the prefilled
// name and ingredient rows so the StrictMode cases can see what reached it.
vi.mock('@/components/household/MealForm', () => ({
  MealForm: ({
    meal,
    onSuccess,
    onCancel,
  }: {
    meal?: MealFormData
    onSuccess: (meal: { id: string }) => void
    onCancel: () => void
  }) => (
    <div>
      {meal && <h1>{meal.name}</h1>}
      <ul aria-label="Ingredients">
        {meal?.prefilledIngredients?.map((row, i) => (
          <li key={i}>{row.ingredient?.name ?? row.originalText}</li>
        ))}
      </ul>
      <button onClick={onCancel}>Cancel</button>
      <button onClick={() => onSuccess({ id: 'meal-1' })}>Save</button>
    </div>
  ),
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

function seedPrefilled(extra: Record<string, unknown>) {
  sessionStorage.setItem(
    'prefilled-meal',
    JSON.stringify({
      name: 'Lentil stew',
      description: null,
      timeMinutes: 25,
      servings: 4,
      mealTypes: ['dinner'],
      kidFriendly: true,
      prefilledIngredients: [],
      ...extra,
    }),
  )
}

function seedImagineSession() {
  sessionStorage.setItem(
    'imagined-meals',
    JSON.stringify({ prompt: 'lentils', meals: [], createdAt: Date.now() }),
  )
}

async function renderLoaded() {
  render(<CreateRecipeClient defaultServings={4} />)
  // `prefilledData` starts as `undefined` and the component renders the
  // skeleton until the load effect settles.
  return screen.findByRole('button', { name: 'Cancel' })
}

describe('CreateRecipeClient routing', () => {
  beforeEach(() => {
    sessionStorage.clear()
    push.mockClear()
  })

  it('renders the skeleton, not an empty page, until the stash has been read', async () => {
    render(<CreateRecipeClient defaultServings={4} />)

    // First paint, before the load effect settles: the route's skeleton.
    expect(screen.getAllByRole('status', { name: 'Loading…' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

    await screen.findByRole('button', { name: 'Cancel' })
    expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument()
  })

  it('cancels back to returnTo when the imagine flow set one', async () => {
    seedPrefilled({ returnTo: '/recipes/imagine' })
    const cancel = await renderLoaded()

    await userEvent.click(cancel)

    expect(push).toHaveBeenCalledWith('/recipes/imagine')
  })

  it('cancels to the library when no returnTo is set (import flow)', async () => {
    seedPrefilled({ originalRecipeText: 'Lentil stew\n- 200g lentils' })
    const cancel = await renderLoaded()

    await userEvent.click(cancel)

    expect(push).toHaveBeenCalledWith('/recipes')
  })

  // `/\\evil.example` and the percent-encoded variants resolve off-origin once
  // the URL parser normalises them — `getValidReturnUrl` is what rejects them.
  it.each([
    'https://evil.example/steal',
    '//evil.example/steal',
    'recipes/imagine',
    '/\\evil.example',
    '/%2F/evil.example',
    '/%5Cevil.example',
    '',
  ])('ignores a tampered returnTo (%s) and cancels to the library', async (returnTo) => {
    seedPrefilled({ returnTo })
    const cancel = await renderLoaded()

    await userEvent.click(cancel)

    expect(push).toHaveBeenCalledWith('/recipes')
  })

  // Saving one of three suggestions does not invalidate the other two, and the
  // stash has to keep mirroring what `/recipes/imagine` renders — clearing it
  // here would blank that page on the next mount.
  it.each([
    ['from the imagine flow', { returnTo: '/recipes/imagine' }],
    ['from the import flow', { originalRecipeText: 'Lentil stew\n- 200g lentils' }],
  ])('leaves the imagine stash alone when a meal %s is saved', async (_label, extra) => {
    seedPrefilled(extra)
    seedImagineSession()
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/recipes'))
    expect(sessionStorage.getItem('imagined-meals')).not.toBeNull()
  })
})

// One event per path that adds a recipe, decided by the stash's `origin`
// (HON-1063). `originalRecipeText` is a form field and must not decide it.
describe('CreateRecipeClient save events', () => {
  beforeEach(() => {
    sessionStorage.clear()
    push.mockClear()
    vi.mocked(track).mockClear()
  })

  async function save() {
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/recipes'))
  }

  it('fires recipe:created, and no other recipe event, for the blank form', async () => {
    await save()

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('recipe:created', { source: 'create_page' })
    expect(track).not.toHaveBeenCalledWith('recipe:imported', expect.anything())
  })

  it('fires recipe:imported for a stash the import flow wrote', async () => {
    seedPrefilled({ origin: 'import', originalRecipeText: 'Lentil stew\n- 200g lentils' })
    await save()

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('recipe:imported', { source: 'import_page' })
  })

  it("fires meal:imagined with the saved meal's id for imagine's Edit details", async () => {
    seedPrefilled({ origin: 'imagine', returnTo: '/recipes/imagine' })
    await save()

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('meal:imagined', {
      meal_id: 'meal-1',
      source: 'imagine_page',
    })
  })

  it('does not read originalRecipeText as the import marker', async () => {
    seedPrefilled({ originalRecipeText: 'Lentil stew\n- 200g lentils' })
    await save()

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('recipe:created', { source: 'create_page' })
  })
})

// `next dev` runs with `reactStrictMode: true`, which mounts, unmounts and
// re-mounts, so the load effect runs twice. The first run consumes the
// single-use stash; the second must not overwrite it with an empty form
// (HON-801).
describe('CreateRecipeClient under StrictMode', () => {
  beforeEach(() => {
    sessionStorage.clear()
    push.mockClear()
  })

  function seedWithIngredients() {
    seedPrefilled({
      originalRecipeText: 'Lentil stew\n- 200g lentils\n- 1 onion',
      prefilledIngredients: [
        {
          type: 'matched',
          ingredient: { id: 'ing-1', name: 'Red lentils', category: 'GRAINS', defaultUnit: 'G' },
          convertedQuantity: 200,
        },
        { type: 'unmatched', originalText: '1 onion' },
      ],
    })
  }

  function renderStrict() {
    render(
      <StrictMode>
        <CreateRecipeClient defaultServings={4} />
      </StrictMode>,
    )
  }

  it('shows the stashed name and ingredient rows', async () => {
    seedWithIngredients()
    renderStrict()

    expect(await screen.findByRole('heading', { name: 'Lentil stew' })).toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Ingredients' })).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['Red lentils', '1 onion'])
  })

  it('consumes the stash, so a reload starts from an empty form', async () => {
    seedWithIngredients()
    renderStrict()

    await screen.findByRole('heading', { name: 'Lentil stew' })
    expect(sessionStorage.getItem('prefilled-meal')).toBeNull()
  })
})
