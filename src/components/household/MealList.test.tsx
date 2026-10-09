import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MealList } from './MealList'
import { createQueryWrapper } from '@/test/query-wrapper'

const EMPTY_LINE = 'No recipes yet. Add a family favourite, import one from a link, or imagine one.'

describe('MealList empty state', () => {
  it('renders one line and the empty action under it', () => {
    render(
      <MealList
        meals={[]}
        onDelete={() => {}}
        onToggleFavorite={() => {}}
        emptyAction={<a href="/recipes/create">Create recipe</a>}
      />,
      createQueryWrapper(),
    )

    expect(screen.getByText(EMPTY_LINE)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create recipe' })).toHaveAttribute(
      'href',
      '/recipes/create',
    )
  })

  it('renders the line alone without an empty action', () => {
    const { container } = render(
      <MealList meals={[]} onDelete={() => {}} onToggleFavorite={() => {}} />,
      createQueryWrapper(),
    )

    expect(screen.getByText(EMPTY_LINE)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    // One line: the old heading-plus-body pair is gone (HON-1128).
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })
})
