import { describe, it, expect, vi } from 'vitest'
vi.unmock('next-intl')
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { ImagineReviewDialog } from './ImagineReviewDialog'
import { buildMeal, renderInLocale } from './ImagineReviewDialog.fixtures'

describe('ImagineReviewDialog focus and units (HON-1366)', () => {
  const lemonMeal = buildMeal({
    prefilledIngredients: [
      {
        type: 'matched',
        ingredient: {
          id: 'lemon',
          name: 'Lemon',
          category: 'fruit',
          defaultUnit: 'piece',
          gramsPerPiece: 100,
        },
        convertedQuantity: 1,
      },
    ],
  })

  it('opens with focus on the dialog, not on the matched-ingredients disclosure', async () => {
    renderInLocale(
      <ImagineReviewDialog open meal={lemonMeal} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      'en',
    )

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
    expect(screen.getByRole('button', { name: '1 ingredient matched' })).not.toHaveFocus()
  })

  it('shows the piece unit on a piece ingredient', () => {
    renderInLocale(
      <ImagineReviewDialog open meal={lemonMeal} onOpenChange={vi.fn()} onSaved={vi.fn()} />,
      'en',
    )

    fireEvent.click(screen.getByRole('button', { name: '1 ingredient matched' }))
    // 1 lemon across 4 servings. The matcher normalises the no-break space.
    expect(screen.getByText('0.3 pc per serving')).toBeInTheDocument()
  })
})
