import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { GroupHeading } from './GroupHeading'

const meta = {
  title: 'Feature/Inventory/GroupHeading',
  component: GroupHeading,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The heading over a group of rows on `/shopping` and `/pantry` — staples, on hand, a category, an urgency bucket, "Other". Caption level under the column\'s Title, with an optional plain count after the label and the group\'s progress right-aligned on the same line.',
      },
    },
  },
  args: {
    label: 'Staples (always stocked)',
    total: 4,
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GroupHeading>

export default meta
type Story = StoryObj<typeof meta>

/** The count's element, found from the heading so the query does not depend on its text. */
function countOf(heading: HTMLElement) {
  const count = heading.lastElementChild
  if (!(count instanceof HTMLElement)) throw new Error('No count in the heading')
  return count
}

/**
 * The count is a plain number in the caption's own colour and size, one weight
 * under the label: no badge, no fill, no ring (HON-1013).
 */
async function expectPlainCount(heading: HTMLElement) {
  const count = countOf(heading)
  await expect(heading.querySelector('[data-slot="badge"]')).toBeNull()
  const own = getComputedStyle(count)
  const caption = getComputedStyle(heading)
  await expect(own.color).toBe(caption.color)
  await expect(own.fontSize).toBe(caption.fontSize)
  await expect(own.fontWeight).toBe('400')
  await expect(caption.fontWeight).toBe('500')
  await expect(own.fontVariantNumeric).toBe('tabular-nums')
  await expect(own.backgroundColor).toBe('rgba(0, 0, 0, 0)')
  await expect(own.borderTopWidth).toBe('0px')
}

export const WithTotal: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "A pantry group: the label and its count as a plain number in the caption's muted colour, one weight lighter.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'Staples (always stocked) 4' })
    await expectPlainCount(heading)
    // The count adds nothing to the caption's 20px line. The `/shopping` and
    // `/pantry` skeletons reserve this height (`src/app/shopping/loading.tsx`);
    // move them together.
    await expect(heading.getBoundingClientRect().height).toBeCloseTo(20, 0)
    // Nothing at the right end until something is bought.
    await expect(heading.parentElement?.childElementCount).toBe(1)
  },
}

export const TwoDigitTotal: Story = {
  args: { label: 'On hand', total: 12 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'On hand 12' })
    await expectPlainCount(heading)
  },
}

export const Progress: Story = {
  args: { emoji: '🥩', label: 'Protein', total: 4, count: '1/4' },
  parameters: {
    docs: {
      description: {
        story:
          'A shopping category once something in it is bought: the count after the label, the purchased fraction at the right end. The category emoji sits before the label with a gap, hidden from screen readers.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'Protein 4' })
    await expect(heading).toHaveTextContent('🥩')
    await expect(canvas.getByText('🥩')).toHaveAttribute('aria-hidden', 'true')
    await expect(canvas.getByText('1/4')).toBeVisible()
    await expect(heading.parentElement?.childElementCount).toBe(2)
  },
}

/**
 * A shopping group on the note's sheet, where the list on Pantry & shopping
 * sits (HON-1016). The count takes the note's muted token through the
 * caption, not the neutral grey.
 */
export const OnNote: Story = {
  args: { emoji: '🥩', label: 'Protein', total: 4, count: '1/4' },
  decorators: [
    (Story) => (
      <div data-surface="note" className="bg-card p-4">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'Protein 4' })
    await expectPlainCount(heading)
    // Not the neutral page's muted grey: measure one outside the scope.
    const neutral = document.createElement('span')
    neutral.className = 'text-muted-foreground'
    document.body.append(neutral)
    try {
      await expect(getComputedStyle(countOf(heading)).color).not.toBe(
        getComputedStyle(neutral).color,
      )
    } finally {
      neutral.remove()
    }
  },
}

export const WithEmoji: Story = {
  args: { emoji: '📝', label: 'Custom items', total: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'Custom items 3' })
    await expect(heading).toHaveTextContent('📝')
  },
}

export const LabelOnly: Story = {
  args: { label: 'On hand', total: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'On hand' })
    // No total and no count: nothing after the label, nothing beside it.
    await expect(heading.childElementCount).toBe(0)
    await expect(heading.parentElement?.childElementCount).toBe(1)
  },
}
