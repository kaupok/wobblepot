import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHouseholdMealListData } from '@/stories/fixtures'
import { createQueryWrapper } from '@/test/query-wrapper'

import { MealList } from './MealList'

vi.mock('@/hooks/use-meal-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-meal-image')>()),
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

  // HON-1389: the detail shows the row's 4-week count, which only My recipes has.
  it("opens with the row's cook history", async () => {
    const user = userEvent.setup()
    render(
      <MealList
        meals={[{ ...meal, lastCookedOn: '2026-10-16', cookedLast28Days: 3 }]}
        householdServings={2}
        onDelete={() => {}}
        onToggleFavorite={() => {}}
        showRecentlyDeleted={false}
      />,
      createQueryWrapper(),
    )

    await user.click(screen.getByRole('button', { name: 'Roast chicken' }))

    const dialog = await screen.findByRole('dialog', { name: 'Roast chicken' })
    expect(
      within(dialog).getByText('Cooked 3 times in 4 weeks, last on Fri, Oct 16'),
    ).toBeInTheDocument()
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

describe('MealList shows a recipe whose image is being drawn (HON-1364)', () => {
  const IMAGE_URL = 'https://store.public.blob.vercel-storage.com/meals/household-meal-1.png'
  const imageReads: string[] = []
  let answers: object[] = []

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    imageReads.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/image')) {
          imageReads.push(url)
          const body = answers.length > 1 ? answers.shift()! : answers[0]
          return new Response(JSON.stringify(body))
        }
        return new Response(JSON.stringify({ meals: [] }))
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function renderList(meal = createHouseholdMealListData({ imageStatus: 'generating' })) {
    const { container } = render(
      <MealList
        meals={[meal]}
        householdServings={2}
        onDelete={() => {}}
        onToggleFavorite={() => {}}
        showRecentlyDeleted={false}
      />,
      createQueryWrapper(),
    )
    return container
  }

  it('shows the plain box, then the image and its tint once it is ready, without a reload', async () => {
    answers = [{ status: 'generating' }, { status: 'ready', imageUrl: IMAGE_URL, imageHue: 40 }]
    const container = renderList()

    expect(screen.getByTestId('meal-card-image-generating')).toHaveClass('bg-muted')
    expect(screen.queryByTestId('meal-card-image')).toBeNull()
    await waitFor(() => expect(imageReads).toHaveLength(1))
    expect(imageReads[0]).toBe('/api/meals/household-meal-1/image')
    expect(screen.getByTestId('meal-card-image-generating')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(5_000)

    await waitFor(() => expect(screen.getByTestId('meal-card-image')).toBeInTheDocument())
    expect(screen.queryByTestId('meal-card-image-generating')).toBeNull()
    expect(screen.getByRole('img', { name: 'Lemon-garlic roast chicken' })).toBeInTheDocument()
    expect(container.querySelector('[data-meal-surface=""]')).not.toBeNull()
  })

  it('drops the box after 90 s of drawing, leaving a normal card', async () => {
    answers = [{ status: 'generating' }]
    const container = renderList()
    await waitFor(() => expect(imageReads).toHaveLength(1))

    await vi.advanceTimersByTimeAsync(90_000)

    await waitFor(() => expect(screen.queryByTestId('meal-card-image-generating')).toBeNull())
    expect(screen.queryByTestId('meal-card-image')).toBeNull()
    expect(container.querySelector('[data-meal-surface]')).toBeNull()
    const reads = imageReads.length
    await vi.advanceTimersByTimeAsync(15_000)
    expect(imageReads).toHaveLength(reads)
  })

  it('drops the box when the image failed', async () => {
    answers = [{ status: 'failed' }]
    renderList()

    await waitFor(() => expect(screen.queryByTestId('meal-card-image-generating')).toBeNull())
    expect(screen.queryByTestId('meal-card-image')).toBeNull()
  })

  it('reads nothing for a recipe that is not being drawn', async () => {
    renderList(createHouseholdMealListData({ imageStatus: 'none' }))

    await vi.advanceTimersByTimeAsync(10_000)

    expect(screen.queryByTestId('meal-card-image-generating')).toBeNull()
    expect(imageReads).toHaveLength(0)
  })
})
