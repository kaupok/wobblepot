import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { lemonGarlicChickenPantry } from '@/stories/fixtures'
import {
  defaultHandlers,
  slowCreateEntryHandlers,
  slowDiscardEntryHandlers,
} from '@/stories/msw-handlers'
import { awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import { TimelineEmptySlot } from './TimelineEmptySlot'

const meta = {
  title: 'Feature/Timeline/TimelineEmptySlot',
  component: TimelineEmptySlot,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    date: '2026-04-16',
    dayLabel: 'Thursday Apr 16',
    mealType: MealType.dinner,
    householdServings: 4,
    pantryIngredients: lemonGarlicChickenPantry,
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TimelineEmptySlot>

export default meta
type Story = StoryObj<typeof meta>

// The button's text is the meal type ("+ Dinner"). Every empty day has one, so
// the name adds the action and the day after the visible text (HON-807,
// HON-1111).
export const Dinner: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Dinner: pick a meal, Thursday Apr 16',
      }),
    ).toBeVisible()
  },
}

export const Lunch: Story = {
  args: { mealType: MealType.lunch },
}

export const Breakfast: Story = {
  args: { mealType: MealType.breakfast },
}

/** Today and Tomorrow have no date beside them, so the day is the word alone. */
export const Tomorrow: Story = {
  args: { date: '2026-04-17', dayLabel: 'Tomorrow', relativeDay: 'tomorrow' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Dinner: pick a meal, Tomorrow' }),
    ).toBeVisible()
  },
}

/** Estonian: the meal type is the whole visible text, so it needs no declension. */
export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Õhtusöök: vali toit, Thursday Apr 16' }),
    ).toHaveTextContent('Õhtusöök')
  },
}

export const Adding: Story = {
  parameters: {
    msw: { handlers: slowCreateEntryHandlers },
    docs: {
      description: {
        story:
          "The create-entry POST never resolves, so clicking '+ Dinner' leaves the button in the 'Adding...' pending state: aria-disabled, so it keeps focus (HON-803).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Dinner: pick a meal/ }))
    const adding = await canvas.findByRole('button', {
      name: 'Adding…: Thursday Apr 16, Dinner',
    })
    await expect(adding).toHaveAttribute('aria-disabled', 'true')
  },
}

export const Discarding: Story = {
  parameters: {
    msw: { handlers: [...slowDiscardEntryHandlers, ...defaultHandlers] },
    docs: {
      description: {
        story:
          "The selector is closed without a pick and the placeholder DELETE never resolves: the selector closes at once, and '+ Dinner' stays aria-disabled until the discard settles (HON-799). It is aria-disabled rather than disabled so it can take focus back from the selector (HON-803).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Dinner: pick a meal/ }))
    const dialog = await within(document.body).findByRole('dialog')
    // The dialog covers the row that was tapped, so its title names the slot,
    // in the short form at this phone viewport (HON-807, HON-941).
    await expect(within(dialog).getByRole('heading', { level: 2 })).toHaveAccessibleName(
      'Dinner for Thu Apr 16',
    )
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /^Dinner: pick a meal/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
  },
}

/**
 * The slot replaces a card whose meal was just cleared, so it takes the
 * focus the card took with it (HON-1123).
 */
export const AutoFocus: Story = {
  args: { autoFocus: true, onAutoFocused: fn() },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Dinner: pick a meal, Thursday Apr 16',
    })
    await waitFor(() => expect(args.onAutoFocused).toHaveBeenCalledTimes(1))
    await expect(document.activeElement).toBe(button)
  },
}
