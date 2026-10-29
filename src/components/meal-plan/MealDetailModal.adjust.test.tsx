import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryWrapper } from '@/test/query-wrapper'

import { MealDetailModal } from './MealDetailModal'
import type { EntryChange, MealData, PreparationSteps } from './types'

// "Adjust recipe" in the cook view opens only from the title row's ⋯ menu
// (HON-1356), with the real `MealDetail` and `AdjustRecipe`.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: () => {} }))
vi.mock('./NoteEditor', () => ({ NoteEditor: () => null }))
vi.mock('./MealImage', () => ({ MealImage: () => null }))

const meal: MealData = {
  id: 'meal-1',
  name: 'Pasta bake',
  kidFriendly: false,
  components: [
    {
      ingredientId: 'pasta',
      quantityPerServing: 100,
      ingredient: { id: 'pasta', name: 'Pasta', category: 'grains', defaultUnit: 'g' },
    },
  ],
  nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
}
const changes: EntryChange[] = []
const cachedTips: PreparationSteps = { steps: ['Boil the pasta'], pitfalls: [] }

const scrollIntoView = vi.fn()
beforeEach(() => {
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  )
})
afterEach(() => vi.unstubAllGlobals())

const baseProps = {
  meal,
  householdServings: 2,
  status: 'planned',
  open: true,
  onOpenChange: vi.fn(),
  planId: 'plan-1',
  entryId: 'entry-1',
  changes,
  initialSteps: cachedTips,
  generateOnOpen: true,
  onDoneCooking: vi.fn(),
} satisfies React.ComponentProps<typeof MealDetailModal>

function renderModal(props: Partial<React.ComponentProps<typeof MealDetailModal>> = {}) {
  const { wrapper } = createQueryWrapper()
  return render(<MealDetailModal {...baseProps} {...props} />, { wrapper })
}

const trigger = () => screen.getByRole('button', { name: 'More actions: Pasta bake' })
const field = () => screen.queryByRole('textbox', { name: 'Adjust recipe' })

async function openMenu() {
  await userEvent.click(trigger())
  return screen.findByRole('menu')
}

describe('MealDetailModal: Adjust recipe (HON-1356)', () => {
  it('opens with no Adjust recipe section', () => {
    renderModal()

    expect(field()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suggest changes' })).not.toBeInTheDocument()
  })

  it('opens the section from the ⋯ menu, with the field focused and scrolled into view', async () => {
    renderModal()

    await openMenu()
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(items).toEqual(['Add note', 'Adjust recipe'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Adjust recipe' }))

    await waitFor(() => expect(field()).toHaveFocus())
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    // The whole section, so "Suggest changes" comes into view with the field.
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(field()!.closest('form'))
    expect(screen.getByRole('button', { name: 'Suggest changes' })).toBeInTheDocument()
  })

  it('Close hides the section and returns focus to the ⋯ trigger', async () => {
    renderModal()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Adjust recipe' }))
    await waitFor(() => expect(field()).toHaveFocus())

    await userEvent.click(screen.getByRole('button', { name: 'Close Adjust recipe' }))

    expect(field()).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('starts closed again when the view reopens', async () => {
    const { rerender } = renderModal()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Adjust recipe' }))
    await waitFor(() => expect(field()).toBeInTheDocument())

    // `MealCard` keeps the view mounted, so only `open` changes.
    rerender(<MealDetailModal {...baseProps} open={false} />)
    rerender(<MealDetailModal {...baseProps} open />)

    expect(field()).not.toBeInTheDocument()
  })

  it('shows a stored request with the section closed', () => {
    renderModal({ adjustmentNote: 'Less salt' })

    expect(screen.getByText('The steps follow your request: Less salt')).toBeInTheDocument()
    expect(field()).not.toBeInTheDocument()
  })

  it.each([
    ['completed', { status: 'completed' as const, onDoneCooking: undefined }],
    ['skipped', { status: 'skipped' as const, onDoneCooking: undefined }],
    ['read-only card', { onDoneCooking: undefined }],
  ])('lists no Adjust recipe on a %s entry', async (_case, props) => {
    renderModal({ ...props, generateOnOpen: false })

    await openMenu()

    expect(screen.getByRole('menuitem', { name: 'Add note' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Adjust recipe' })).not.toBeInTheDocument()
  })

  it('has no ⋯ menu in the read-only demo', () => {
    renderModal({ readOnly: true, onDoneCooking: undefined, generateOnOpen: false })

    expect(
      screen.queryByRole('button', { name: 'More actions: Pasta bake' }),
    ).not.toBeInTheDocument()
    expect(field()).not.toBeInTheDocument()
  })
})
