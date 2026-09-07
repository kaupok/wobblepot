import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { ShoppingEmptyState } from './ShoppingEmptyState'
import { WINDOW_STORAGE_KEY } from './use-shopping-window'

const meta = {
  title: 'Feature/Shopping/ShoppingEmptyState',
  component: ShoppingEmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The card `/shopping` renders instead of `ShoppingSection` when there is nothing to buy. Four variants cover the four reasons the list can be empty. The two list-shaped ones — `nothing-needed` and `all-purchased` — render the shared `ShoppingListHeader`, so the 7/14-day window picker is reachable from either; widening the window is the natural next step in both. `no-plan` and `error` are not list states, so they stay header-less.',
      },
    },
  },
  args: {
    variant: 'no-plan',
  },
} satisfies Meta<typeof ShoppingEmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const NoPlan: Story = {
  args: { variant: 'no-plan' },
  parameters: {
    docs: {
      description: {
        story:
          'No meal plan exists yet, so there is nothing to derive a list from. Primary CTA sends the user to `/meal-plan` to generate one. No header: a wider window cannot conjure a plan.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('combobox', { name: /time window/i })).not.toBeInTheDocument()
  },
}

export const AllPurchased: Story = {
  args: { variant: 'all-purchased', windowDays: 7 },
  parameters: {
    docs: {
      description: {
        story:
          'Every item on the list has been checked off. Rendered by `ShoppingSection` itself once the last item is purchased, so it has no CTA — the user is already done. It does get the header, because widening to 14 days is the one thing left worth doing from here; `ShoppingSection` passes its own `windowDays` down so the picker opens on the window the user is looking at.',
      },
    },
  },
}

export const NothingNeeded: Story = {
  args: { variant: 'nothing-needed', windowDays: 7 },
  parameters: {
    docs: {
      description: {
        story:
          'A plan exists but the pantry already covers it. The header shows the "Shopping list" title beside the window picker, so widening to 14 days is reachable without leaving the empty state.',
      },
    },
  },
}

export const NothingNeededFourteenDays: Story = {
  args: { variant: 'nothing-needed', windowDays: 14 },
  // The day count in the body copy comes from the `windowDays` prop, so this
  // story renders the 14-day text with or without the seed. The seed states
  // which reachable state is being documented: a user who chose 14 days, rather
  // than one who arrived on an explicit `?days=14` with no preference stored.
  // `useShoppingWindow` leaves both alone — it reconciles only when a stored
  // preference actually disagrees with the prop.
  beforeEach: () => {
    localStorage.setItem(WINDOW_STORAGE_KEY, '14')
    return () => localStorage.removeItem(WINDOW_STORAGE_KEY)
  },
  parameters: {
    docs: {
      description: {
        story:
          'The same variant at the wider window — the body copy interpolates the day count, so this is the only story that exercises `windowDays`.',
      },
    },
  },
}

export const ErrorState: Story = {
  args: { variant: 'error' },
  parameters: {
    docs: {
      description: {
        story:
          'The shopping-list request failed. Same card shell as the other variants, with a CTA rather than a retry — reloading the route is the retry, and no header, since the window is not what failed. Note the CTA is labelled "Go to dashboard" but its `href` is `/meal-plan`, the same destination as the `no-plan` CTA; the dashboard is `/`. Pre-existing and pinned by `ShoppingEmptyState.test.tsx` — tracked in HON-623, not changed here.',
      },
    },
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <ShoppingEmptyState variant="no-plan" />
      <ShoppingEmptyState variant="all-purchased" windowDays={7} />
      <ShoppingEmptyState variant="nothing-needed" windowDays={7} />
      <ShoppingEmptyState variant="error" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'All four variants stacked, for reviewing heading size and card rhythm side by side, and for seeing which two carry the header. The headings are Title level (`variant="h4"`) per the docs/DESIGN.md type scale.',
      },
    },
  },
}
