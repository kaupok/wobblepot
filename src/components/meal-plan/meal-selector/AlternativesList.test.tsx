import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { createQueryWrapper } from '@/test/query-wrapper'
import { misoSalmonAlternative } from '@/stories/fixtures'
import type { AlternativeMeal } from '../types'
import { AlternativeSkeleton, AlternativesList } from './AlternativesList'

vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: vi.fn() }))

const STEP = 'Glaze the salmon and broil it for 8 minutes.'

const meals: AlternativeMeal[] = [
  misoSalmonAlternative,
  {
    ...misoSalmonAlternative,
    id: 'alt-2',
    name: 'Lemon-garlic roast chicken',
    isCustom: true,
    preparationNotes: 'Rub the lemon under the skin.',
  },
]

/** The list inside the same `DialogContent` that `MealSelectorModal` renders it in. */
function renderInPicker() {
  const onPickerOpenChange = vi.fn()
  render(
    <Dialog open onOpenChange={onPickerOpenChange}>
      <DialogContent>
        <DialogTitle>Pick a dinner</DialogTitle>
        <AlternativesList
          meals={meals}
          isLoading={false}
          householdServings={4}
          onSelect={vi.fn()}
        />
      </DialogContent>
    </Dialog>,
    createQueryWrapper(),
  )
  return { onPickerOpenChange }
}

// HON-1352: the name opens the cook view over the picker.
describe('AlternativesList cook view', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ tips: { steps: [STEP], pitfalls: [] } }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['a library meal', 'Miso-glazed salmon with rice', 'alt-1'],
    ['a household recipe', 'Lemon-garlic roast chicken', 'alt-2'],
  ])('opens %s from its name, with its steps', async (_kind, name, id) => {
    const user = userEvent.setup()
    renderInPicker()

    await user.click(screen.getByRole('button', { name }))

    const view = await screen.findByRole('dialog', { name })
    expect(await within(view).findByText(STEP)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(`/api/meals/${id}/preparation-steps`, expect.anything())
  })

  it("shows a household recipe's own notes, as from My recipes", async () => {
    const user = userEvent.setup()
    renderInPicker()

    await user.click(screen.getByRole('button', { name: 'Lemon-garlic roast chicken' }))

    const view = await screen.findByRole('dialog', { name: 'Lemon-garlic roast chicken' })
    await user.click(await within(view).findByRole('button', { name: 'Your notes' }))
    expect(within(view).getByText('Rub the lemon under the skin.')).toBeInTheDocument()
  })

  it('closes only the cook view on Escape, with focus back on the name', async () => {
    const user = userEvent.setup()
    const { onPickerOpenChange } = renderInPicker()
    const name = screen.getByRole('button', { name: 'Lemon-garlic roast chicken' })

    await user.click(name)
    await screen.findByRole('dialog', { name: 'Lemon-garlic roast chicken' })
    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Lemon-garlic roast chicken' })).toBeNull(),
    )
    expect(screen.getByRole('dialog', { name: 'Pick a dinner' })).toBeInTheDocument()
    expect(onPickerOpenChange).not.toHaveBeenCalled()
    expect(name).toHaveFocus()
  })
})

// HON-1352: the cards lost the "Show ingredients" toggle, so their skeleton did too.
describe('AlternativesList loading', () => {
  it('draws three cards of three text bars and a Select bar, with no toggle or list bars', () => {
    const { container } = render(
      <AlternativesList meals={[]} isLoading householdServings={4} onSelect={vi.fn()} />,
    )

    const cards = container.querySelectorAll('[data-slot="card"]')
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(within(card as HTMLElement).getAllByRole('status')).toHaveLength(4)
    }
    expect(screen.queryByTestId('ingredient-list-skeleton')).toBeNull()
  })

  it("keeps the ingredient bars for the imagine panel's cards", () => {
    render(<AlternativeSkeleton ingredients="list" />)

    expect(screen.getByTestId('ingredient-list-skeleton')).toBeInTheDocument()
  })
})
