import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MealList } from './MealList'
import { createQueryWrapper } from '@/test/query-wrapper'
import { createHouseholdMealListData } from '@/stories/fixtures'

vi.mock('@/hooks/use-meal-image', () => ({
  useMealImage: () => ({ status: 'none', imageUrl: null, imageHue: null, cancelImage: vi.fn() }),
}))
vi.mock('@/hooks/use-wake-lock', () => ({ useWakeLock: vi.fn() }))

const EMPTY_LINE = 'No recipes yet. Add a family favourite, import one from a link, or imagine one.'

describe('MealList empty state', () => {
  it('renders one line and the empty action under it', () => {
    render(
      <MealList
        householdServings={2}
        meals={[]}
        onDelete={() => {}}
        onToggleFavorite={() => {}}
        emptyAction={<a href="/recipes/import">Add recipe</a>}
      />,
      createQueryWrapper(),
    )

    expect(screen.getByText(EMPTY_LINE)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add recipe' })).toHaveAttribute(
      'href',
      '/recipes/import',
    )
  })

  it('renders the line alone without an empty action', () => {
    const { container } = render(
      <MealList meals={[]} householdServings={2} onDelete={() => {}} onToggleFavorite={() => {}} />,
      createQueryWrapper(),
    )

    expect(screen.getByText(EMPTY_LINE)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    // One line: the old heading-plus-body pair is gone (HON-1128).
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })
})

describe('MealList opens a recipe in the cook view', () => {
  const meal = createHouseholdMealListData({ name: 'Roast chicken' })

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ tips: { steps: [], pitfalls: [] } }))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderList() {
    render(
      <MealList
        meals={[meal]}
        householdServings={2}
        onDelete={() => {}}
        onToggleFavorite={() => {}}
        showRecentlyDeleted={false}
      />,
      createQueryWrapper(),
    )
    return screen.getByRole('button', { name: 'Roast chicken' })
  }

  it('opens from the name, and closing returns focus to it', async () => {
    const user = userEvent.setup()
    const name = renderList()

    await user.click(name)

    expect(await screen.findByRole('dialog', { name: 'Roast chicken' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(name).toHaveFocus()
  })

  it('opens from the card outside its controls, with focus returning to the name', async () => {
    const user = userEvent.setup()
    const name = renderList()

    await user.click(screen.getByText(meal.description!))

    expect(await screen.findByRole('dialog', { name: 'Roast chicken' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(name).toHaveFocus())
  })

  it('does not open from the heart, the menu trigger or a menu item', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(screen.getByRole('button', { name: 'Add to favourites' }))
    await user.click(screen.getByRole('button', { name: /More actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    // The delete confirmation, not the cook view.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Roast chicken' })).toBeNull()
  })
})
