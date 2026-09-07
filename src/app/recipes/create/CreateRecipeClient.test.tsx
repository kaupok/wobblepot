import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CreateRecipeClient } from './CreateRecipeClient'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('prefilled=true'),
}))

// The form itself is covered by `MealForm`'s own tests and stories; this suite
// is about which route Cancel/Save lands on and what they clear, so the form is
// reduced to the two callbacks that drive those decisions.
vi.mock('@/components/household/MealForm', () => ({
  MealForm: ({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) => (
    <div>
      <button onClick={onCancel}>Cancel</button>
      <button onClick={onSuccess}>Save</button>
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
  // `prefilledData` starts as `undefined` and the component renders null until
  // the load effect settles.
  return screen.findByRole('button', { name: 'Cancel' })
}

describe('CreateRecipeClient routing', () => {
  beforeEach(() => {
    sessionStorage.clear()
    push.mockClear()
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

  it.each(['https://evil.example/steal', '//evil.example/steal', 'recipes/imagine'])(
    'ignores a tampered returnTo (%s) and cancels to the library',
    async (returnTo) => {
      seedPrefilled({ returnTo })
      const cancel = await renderLoaded()

      await userEvent.click(cancel)

      expect(push).toHaveBeenCalledWith('/recipes')
    },
  )

  it('clears the imagine stash when a meal from the imagine flow is saved', async () => {
    seedPrefilled({ returnTo: '/recipes/imagine' })
    seedImagineSession()
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(sessionStorage.getItem('imagined-meals')).toBeNull())
    expect(push).toHaveBeenCalledWith('/recipes')
  })

  it('leaves the imagine stash alone when an imported recipe is saved', async () => {
    seedPrefilled({ originalRecipeText: 'Lentil stew\n- 200g lentils' })
    seedImagineSession()
    await renderLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/recipes'))
    expect(sessionStorage.getItem('imagined-meals')).not.toBeNull()
  })
})
