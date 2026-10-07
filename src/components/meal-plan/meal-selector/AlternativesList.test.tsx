import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { misoSalmonAlternative } from '@/stories/fixtures'
import type { AlternativeMeal } from '../types'
import { AlternativesList } from './AlternativesList'

const meals: AlternativeMeal[] = [
  misoSalmonAlternative,
  { ...misoSalmonAlternative, id: 'alt-2', name: 'Lemon-garlic roast chicken' },
]

/** The list inside the same `DialogContent` that `MealSelectorModal` renders it in. */
function InDialog({ open }: { open: boolean }) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogTitle>Pick a dinner</DialogTitle>
        <AlternativesList
          meals={meals}
          isLoading={false}
          householdServings={4}
          onSelect={vi.fn()}
        />
      </DialogContent>
    </Dialog>
  )
}

// HON-1115: one "Show ingredients" toggle state for the whole grid.
describe('AlternativesList ingredients toggle', () => {
  it('opens and closes the lists on every card from one toggle', async () => {
    render(<InDialog open />)

    expect(screen.queryAllByRole('list')).toHaveLength(0)
    await userEvent.click(screen.getAllByRole('button', { name: 'Show ingredients' })[0]!)

    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Hide ingredients' })).toHaveLength(2)

    await userEvent.click(screen.getAllByRole('button', { name: 'Hide ingredients' })[1]!)
    expect(screen.queryAllByRole('list')).toHaveLength(0)
  })

  it('starts closed again the next time the dialog opens', async () => {
    const { rerender } = render(<InDialog open />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Show ingredients' })[0]!)
    expect(screen.getAllByRole('list')).toHaveLength(2)

    rerender(<InDialog open={false} />)
    rerender(<InDialog open />)

    expect(screen.queryAllByRole('list')).toHaveLength(0)
    expect(screen.getAllByRole('button', { name: 'Show ingredients' })).toHaveLength(2)
  })
})
