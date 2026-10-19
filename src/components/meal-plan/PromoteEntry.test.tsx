import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryWrapper } from '@/test/query-wrapper'
import { PromoteEntry } from './PromoteEntry'
import type { EntryChange } from './types'

// "Make it my recipe" (HON-1245) with the real dialog and `usePromoteEntry`;
// only `fetch`, the router, the toasts and analytics are stubbed.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
const track = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics', () => ({ track }))

const URL = '/api/meal-plans/plan-1/entries/entry-1/components/promote'

const live: EntryChange = {
  id: 'change-1',
  original: { id: 'cream', name: 'Cream' },
  replacement: { id: 'yoghurt', name: 'Yoghurt' },
  quantityPerServing: 60,
  stale: false,
}

let fetchMock: ReturnType<typeof vi.fn>
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock = vi.fn(() => Promise.resolve(json({ outcome: 'forked', mealId: 'meal-new' })))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderPromote(props: Partial<React.ComponentProps<typeof PromoteEntry>> = {}) {
  const onChanged = vi.fn()
  const { wrapper } = createQueryWrapper()
  render(
    <PromoteEntry
      planId="plan-1"
      entryId="entry-1"
      changes={[live]}
      isCustom={false}
      mealName="Tuna pasta"
      onChanged={onChanged}
      {...props}
    />,
    { wrapper },
  )
  return { onChanged }
}

const sentBody = () => JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)

describe('PromoteEntry', () => {
  it('is hidden when every change is stale', () => {
    renderPromote({ changes: [{ ...live, stale: true }] })

    expect(screen.queryByRole('button', { name: 'Make it my recipe' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update the recipe' })).not.toBeInTheDocument()
  })

  it('on a library meal, saves a new recipe under the name the household gives it', async () => {
    const { onChanged } = renderPromote()

    await userEvent.click(screen.getByRole('button', { name: 'Make it my recipe' }))
    const dialog = screen.getByRole('dialog', { name: 'Make it my recipe' })
    expect(dialog).toHaveTextContent(
      'A new recipe with these ingredients goes to My recipes, and this meal uses it.',
    )
    const name = screen.getByRole('textbox', { name: 'Recipe name' })
    expect(name).toHaveValue('Tuna pasta (my version)')
    await userEvent.clear(name)
    await userEvent.type(name, '  Weeknight tuna pasta ')
    await userEvent.click(screen.getByRole('button', { name: 'Save to My recipes' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Saved to My recipes'))
    expect(fetchMock.mock.calls[0]![0]).toBe(URL)
    expect(sentBody()).toEqual({ name: 'Weeknight tuna pasta' })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('recipe:created', { source: 'plan_entry' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not submit a blank name', async () => {
    renderPromote()

    await userEvent.click(screen.getByRole('button', { name: 'Make it my recipe' }))
    await userEvent.clear(screen.getByRole('textbox', { name: 'Recipe name' }))

    expect(screen.getByRole('button', { name: 'Save to My recipes' })).toBeDisabled()
  })

  it("on the household's own recipe, says every planned meal changes and asks no name", async () => {
    fetchMock.mockResolvedValue(json({ outcome: 'updated', mealId: 'meal-own' }))
    renderPromote({ isCustom: true })

    await userEvent.click(screen.getByRole('button', { name: 'Update the recipe' }))
    const dialog = screen.getByRole('dialog', { name: 'Update the recipe' })
    expect(dialog).toHaveTextContent(
      'The recipe gets these ingredients. Every planned meal of this recipe changes too.',
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Update the recipe' }).at(-1)!)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Recipe updated'))
    expect(track).not.toHaveBeenCalled()
  })

  it.each([
    ['noChanges', 409, 'This meal has no changes to keep.'],
    ['notPlanned', 409, 'Only a planned meal can be saved as a recipe.'],
    ['mealNotFound', 404, 'This recipe is no longer available.'],
    ['invalidRecipe', 400, 'A recipe needs 1 to 50 ingredients. Change the list and try again.'],
    [
      'ingredientNotFound',
      404,
      'An ingredient in the list is no longer available. Change the list and try again.',
    ],
    ['somethingNew', 500, 'Could not save the recipe. Try again.'],
  ])('shows catalog copy for %s, never the server text', async (code, status, copy) => {
    fetchMock.mockResolvedValue(json({ error: 'English server text', code }, status))
    const { onChanged } = renderPromote()

    await userEvent.click(screen.getByRole('button', { name: 'Make it my recipe' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save to My recipes' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy))
    expect(onChanged).not.toHaveBeenCalled()
    // A refusal keeps the dialog open, so the household can try again.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
