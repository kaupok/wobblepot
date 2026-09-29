import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { UnmatchedIngredientRow } from './UnmatchedIngredientRow'
import type { UnmatchedIngredientData } from './IngredientRow'

function data(extractedName: string): UnmatchedIngredientData {
  return {
    type: 'unmatched',
    extractedName,
    originalText: `200g ${extractedName}`,
    extractedQuantity: 200,
    extractedUnit: 'g',
  }
}

describe('UnmatchedIngredientRow search field name', () => {
  // getByLabelText matches aria-label but not a placeholder (HON-808). Several
  // rows render at once on the import review, so each name carries its
  // ingredient. The global next-intl mock answers from the English catalog.
  it('names each row search after the ingredient it resolves', () => {
    const { wrapper } = createQueryWrapper()
    render(
      <>
        <UnmatchedIngredientRow data={data('gochujang')} disabled={false} onRemove={vi.fn()} />
        <UnmatchedIngredientRow data={data('yuzu kosho')} disabled={false} onRemove={vi.fn()} />
      </>,
      { wrapper },
    )

    expect(screen.getByLabelText('Find a match for gochujang')).toHaveAttribute(
      'placeholder',
      'Search ingredients…',
    )
    expect(screen.getByLabelText('Find a match for yuzu kosho')).toBeInTheDocument()
  })
})
