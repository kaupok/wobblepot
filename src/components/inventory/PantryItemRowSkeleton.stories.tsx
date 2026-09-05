import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { createPantryItemData } from '@/stories/fixtures'
import { PantryItemRow } from './PantrySection'
import { PantryItemRowSkeleton } from './PantryItemRowSkeleton'

/** Rounded so sub-pixel noise can't fail the comparison; 1px of drift still does. */
function rowHeight(element: HTMLElement): number {
  return Math.round(element.getBoundingClientRect().height)
}

const noop = fn(async () => {})

const meta = {
  title: 'Feature/Inventory/PantryItemRowSkeleton',
  component: PantryItemRowSkeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The placeholder `/shopping` shows for each pantry row while the list loads. Same contract as `ShoppingItemSkeleton` — the play function measures it against the live row — but against `PantrySection`'s `PantryItemRow`, which is what the screen renders. (`components/pantry/PantryItem.tsx` reads like the counterpart and is not one: it has no callsite outside its own story and test.) It is 4px taller than the shopping skeleton, because a pantry row has no `min-h-touch` floor and takes its height from its two `icon-sm` buttons.",
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
} satisfies Meta<typeof PantryItemRowSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AgainstLiveRow: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <div data-testid="skeleton">
        <PantryItemRowSkeleton />
      </div>
      <div data-testid="pantry-row">
        <PantryItemRow item={createPantryItemData()} onToggleStaple={noop} onRemove={noop} />
      </div>
      <div data-testid="pantry-row-needed">
        <PantryItemRow
          item={createPantryItemData({
            neededQuantity: 500,
            neededDisplayQuantity: '500g',
            windowDays: 7,
          })}
          onToggleStaple={noop}
          onRemove={noop}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The skeleton above the row it replaces, stacked at the `gap-2` the real list uses. The third row is the same component with a "needed in window" caption — `/api/pantry` sends those fields only for ingredients the plan needs, which makes that row 12px taller. The skeleton mirrors the floor, since a loading state cannot know which rows will carry a caption; only that equality is asserted.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    expect(rowHeight(canvas.getByTestId('skeleton'))).toBe(
      rowHeight(canvas.getByTestId('pantry-row')),
    )
  },
}
