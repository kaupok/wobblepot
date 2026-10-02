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
          'The heading over a group of rows on `/shopping` and `/pantry` — staples, on hand, a category, an urgency bucket, "Other". Caption level under the column\'s Title, with an optional round count badge after the label and the group\'s progress right-aligned on the same line.',
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

/** The badge's box, found from the heading so the query does not depend on its text. */
function countBadge(heading: HTMLElement) {
  const badge = heading.querySelector<HTMLElement>('[data-slot="badge"]')
  if (!badge) throw new Error('No count badge in the heading')
  return badge
}

export const WithTotal: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "A pantry group: the label and a round count badge. One digit makes a circle, sitting on the caption's baseline.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'Staples (always stocked) 4' })
    const badge = countBadge(heading)
    const box = badge.getBoundingClientRect()
    // One digit: a circle.
    await expect(box.width).toBeCloseTo(box.height, 0)
    // The digit shares the caption's baseline. Both are the same `text-xs`
    // font, so their glyph boxes end at the same place when the baselines meet.
    const textBottom = (node: Node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      return range.getBoundingClientRect().bottom
    }
    const label = [...heading.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
    if (!label) throw new Error('No label text in the heading')
    await expect(Math.abs(textBottom(badge) - textBottom(label))).toBeLessThan(1)
    // Nothing at the right end until something is bought.
    await expect(heading.parentElement?.childElementCount).toBe(1)
  },
}

export const TwoDigitTotal: Story = {
  args: { label: 'On hand', total: 12 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { level: 3, name: 'On hand 12' })
    const box = countBadge(heading).getBoundingClientRect()
    // Two digits: a short pill, no narrower than it is tall.
    await expect(box.width).toBeGreaterThan(box.height)
  },
}

export const Progress: Story = {
  args: { emoji: '🥩', label: 'Protein', total: 4, count: '1/4' },
  parameters: {
    docs: {
      description: {
        story:
          'A shopping category once something in it is bought: the count badge after the label, the purchased fraction at the right end. The category emoji sits before the label with a gap, hidden from screen readers.',
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
    // No total and no count: no badge, nothing beside the label.
    await expect(heading.querySelector('[data-slot="badge"]')).toBeNull()
    await expect(heading.parentElement?.childElementCount).toBe(1)
  },
}
