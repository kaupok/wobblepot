import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ShoppingEmptyState } from './ShoppingEmptyState'

const WINDOW_STORAGE_KEY = 'shopping-list-window-days'

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
  // The day count in the body copy comes from the `windowDays` prop, so this
  // story would render the 14-day text with or without the seed. What the seed
  // changes is the mount effect: `ShoppingEmptyState` reconciles the stored
  // preference against the prop and pushes when they disagree. Storybook's
  // app-router `push` is a spy and cannot navigate, so an unseeded story would
  // sit in a state the real app never holds — 14-day copy with a pending
  // redirect to `?days=7`. Seeding makes the story a real reachable state.
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
          'The shopping-list request failed. Same card shell as the other variants, with a CTA rather than a retry — reloading the route is the retry. Note the CTA is labelled "Go to dashboard" but its `href` is `/meal-plan`, the same destination as the `no-plan` CTA; the dashboard is `/`. Pre-existing and pinned by `ShoppingEmptyState.test.tsx:70` — tracked in HON-623, not changed here.',
      },
    },
  },
}

export const WindowPickerSwitchesWindow: Story = {
  args: { variant: 'nothing-needed', windowDays: 7 },
  // The picker writes the stored preference before navigating, so leaving it at
  // 14 would change what every later story mounts with.
  beforeEach: () => () => localStorage.removeItem(WINDOW_STORAGE_KEY),
  parameters: {
    docs: {
      description: {
        story:
          'Behavioural contract of the window picker: choosing "14 days" persists the preference under `shopping-list-window-days` and routes to `/shopping?days=14`. The persistence is what makes the choice survive the navigation — the new page reads it back on mount.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: /time window/i })
    await userEvent.click(trigger)

    // Radix portals `SelectContent` outside the canvas.
    const body = within(document.body)
    await userEvent.click(await body.findByRole('option', { name: '14 days' }))

    // Radix keeps the listbox mounted through its exit animation and leaves an
    // `aria-hidden` wrapper in place until it finishes. The a11y gate runs in an
    // `afterEach`, so returning early makes axe audit a half-closed dropdown.
    await waitFor(() => {
      expect(document.querySelectorAll('[role="listbox"]').length).toBe(0)
    })

    expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe('14')
    expect(getRouter().push).toHaveBeenCalledWith('/shopping?days=14')
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
