import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { createPantryItemData } from '@/stories/fixtures'
import { PantryItem } from './PantryItem'
import { PantryItemSkeleton } from './PantryItemSkeleton'

/** Rounded so sub-pixel noise can't fail the comparison; 1px of drift still does. */
function rowHeight(element: HTMLElement): number {
  return Math.round(element.getBoundingClientRect().height)
}

const meta = {
  title: 'Feature/Pantry/PantryItemSkeleton',
  component: PantryItemSkeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The placeholder `/shopping` shows for each pantry row while the list loads. Same contract as `ShoppingItemSkeleton` — the play function measures it against the live `PantryItem` — but 4px taller, because a pantry row has no `min-h-touch` floor and takes its height from its two `icon-sm` buttons instead.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PantryItemSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AgainstLiveRow: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div data-testid="skeleton">
        <PantryItemSkeleton />
      </div>
      <div data-testid="pantry-item">
        <PantryItem item={createPantryItemData()} onToggleStaple={fn()} onRemove={fn()} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The skeleton above the row it replaces. Heights are compared, never hardcoded, so the guard survives a deliberate row redesign and fails on a one-sided one.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(rowHeight(canvas.getByTestId('skeleton'))).toBe(
      rowHeight(canvas.getByTestId('pantry-item')),
    )
  },
}
