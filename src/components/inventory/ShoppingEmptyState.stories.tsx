import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ShoppingEmptyState } from './ShoppingEmptyState'

const meta = {
  title: 'Feature/Shopping/ShoppingEmptyState',
  component: ShoppingEmptyState,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The card `/shopping` renders instead of `ShoppingSection` when there is nothing to buy. Four variants cover the four reasons the list can be empty; only `nothing-needed` also renders the 7/14-day window picker, because that is the one case where widening the window can produce items.',
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
          'No meal plan exists yet, so there is nothing to derive a list from. Primary CTA sends the user to `/meal-plan` to generate one.',
      },
    },
  },
}

export const AllPurchased: Story = {
  args: { variant: 'all-purchased' },
  parameters: {
    docs: {
      description: {
        story:
          'Every item on the list has been checked off. Rendered by `ShoppingSection` itself once the last item is purchased, so it has no CTA — the user is already done.',
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
          'A plan exists but the pantry already covers it. The only variant with a `CardHeader`: it shows the "Shopping list" title beside the window picker, so widening to 14 days is reachable without leaving the empty state.',
      },
    },
  },
}

export const NothingNeededFourteenDays: Story = {
  args: { variant: 'nothing-needed', windowDays: 14 },
  // The component reconciles `windowDays` against the stored preference on mount and
  // navigates when they disagree. Seed the preference so this story renders the
  // 14-day copy instead of immediately pushing back to `?days=7`.
  beforeEach: () => {
    localStorage.setItem('shopping-list-window-days', '14')
    return () => localStorage.removeItem('shopping-list-window-days')
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
          'The shopping-list request failed. Same card shell as the other variants, with a CTA back to the dashboard rather than a retry — reloading the route is the retry.',
      },
    },
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <ShoppingEmptyState variant="no-plan" />
      <ShoppingEmptyState variant="all-purchased" />
      <ShoppingEmptyState variant="nothing-needed" />
      <ShoppingEmptyState variant="error" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'All four variants stacked, for reviewing heading size and card rhythm side by side. The headings are Title level (`variant="h4"`) per the docs/DESIGN.md type scale.',
      },
    },
  },
}
