import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { misoSalmonAlternative } from '@/stories/fixtures'
import { Body } from '@/components/ui/typography'
import type { AlternativeMeal } from '../types'
import { AlternativesList } from './AlternativesList'

const meals: AlternativeMeal[] = [
  misoSalmonAlternative,
  { ...misoSalmonAlternative, id: 'alt-2', name: 'Lemon-garlic roast chicken' },
  { ...misoSalmonAlternative, id: 'alt-3', name: 'Red lentil dhal' },
]

const meta = {
  title: 'Meal plan/AlternativesList',
  component: AlternativesList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Presentational grid of meal alternatives used by `MealSelectorModal`. Owns the skeleton, error, empty and load-more states; the caller supplies data plus the mode-specific header and empty-state copy.',
      },
    },
  },
  args: {
    meals,
    isLoading: false,
    householdSize: 4,
    onSelect: fn(),
    header: 'Suggested for you',
  },
} satisfies Meta<typeof AlternativesList>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Selecting: Story = {
  args: { selectingId: 'alt-2' },
  parameters: {
    docs: {
      description: { story: 'One card is mid-request; its own button shows the busy state.' },
    },
  },
}

export const Loading: Story = {
  args: { isLoading: true },
  parameters: {
    docs: {
      description: {
        story:
          'Three skeleton cards stand in for the grid: text bars and a button bar, with no 3:2 image block, since most library meals have no image (HON-943). No header is rendered.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-slot="card"]')).toHaveLength(3)
    await expect(canvasElement.querySelector('[data-shape="flush"]')).toBeNull()
  },
}

/** From `md` the skeleton's button bar is label-wide, as the Select buttons are. */
export const LoadingDesktop: Story = {
  args: { isLoading: true },
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-shape="flush"]')).toBeNull()
  },
}

/** From `md` each Select is `outline` and as wide as its label (HON-943). */
export const PopulatedDesktop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const buttons = await within(canvasElement).findAllByRole('button', { name: /^select$/i })
    await expect(buttons).toHaveLength(3)
    for (const button of buttons) {
      const card = button.closest<HTMLElement>('[data-slot="card"]')!.getBoundingClientRect()
      await expect(button).toHaveAttribute('data-variant', 'outline')
      await expect(button.getBoundingClientRect().width).toBeLessThan(card.width / 2)
    }
  },
}

export const ErrorState: Story = {
  name: 'Error',
  args: { error: 'Could not update meal' },
  parameters: {
    docs: {
      description: {
        story:
          'An error replaces the whole list — header, grid and empty state are all suppressed.',
      },
    },
  },
}

export const Empty: Story = {
  args: {
    meals: [],
    emptyState: (
      <Body variant="muted" className="text-center">
        No meals matched “tofu”
      </Body>
    ),
  },
}

export const EmptyWithoutCopy: Story = {
  args: { meals: [], emptyState: null },
  parameters: {
    docs: {
      description: {
        story:
          'Search mode before the first response has arrived: the list is empty but there is nothing worth saying yet, so the caller passes no empty state.',
      },
    },
  },
}

export const WithLoadMore: Story = {
  args: {
    hasMore: true,
    loadMoreLabel: 'Load more (3 of 24)',
    loadingLabel: 'Loading…',
    onLoadMore: fn(),
  },
}

export const LoadingMore: Story = {
  args: {
    hasMore: true,
    isLoadingMore: true,
    loadMoreLabel: 'Load more (3 of 24)',
    loadingLabel: 'Loading…',
    onLoadMore: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'The next page is in flight — the button is disabled and shows the loading label.',
      },
    },
  },
}

export const SelectAndLoadMoreInvokeCallbacks: Story = {
  args: {
    hasMore: true,
    loadMoreLabel: 'Load more (3 of 24)',
    loadingLabel: 'Loading…',
    onLoadMore: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)

    const selectButtons = await canvas.findAllByRole('button', { name: /^select$/i })
    await userEvent.click(selectButtons[1]!)
    await expect(args.onSelect).toHaveBeenCalledWith('alt-2')

    await userEvent.click(canvas.getByRole('button', { name: /load more/i }))
    await expect(args.onLoadMore).toHaveBeenCalled()
  },
}
