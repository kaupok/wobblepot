import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createQueryWrapper } from '@/test/query-wrapper'
import { InlineAddItem } from './InlineAddItem'

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

describe('InlineAddItem field name', () => {
  // getByLabelText matches aria-label but not a placeholder, so this fails if
  // the search is named only by its placeholder (HON-808). The global
  // next-intl mock answers from the English catalog.
  it('names the pantry search independently of its placeholder', () => {
    const { wrapper } = createQueryWrapper()
    render(<InlineAddItem onItemAdded={vi.fn()} />, { wrapper })

    expect(screen.getByLabelText('Add ingredient to pantry')).toHaveAttribute(
      'placeholder',
      'Add ingredient to pantry…',
    )
  })
})
