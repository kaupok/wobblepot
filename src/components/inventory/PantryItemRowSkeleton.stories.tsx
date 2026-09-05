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
          'The placeholder `/shopping` shows for each pantry row while the list loads. Same contract as `ShoppingItemSkeleton` — the play function measures it against the live row — but against `PantrySection`\'s `PantryItemRow`, which is what the screen renders. (`components/pantry/PantryItem.tsx` reads like the counterpart and is not one: it has no callsite outside its own story and test.) A pantry row has no `min-h-touch` floor: its height comes from the name and "needed in window" caption stacked over its two `icon-sm` buttons.',
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
      <div data-testid="pantry-row">
        <PantryItemRow item={createPantryItemData()} onToggleStaple={noop} onRemove={noop} />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The skeleton above both variants of the row it replaces, stacked at the `gap-2` the real list uses. The middle row is the one whose ingredient the plan needs — the variant this route serves, and the one the skeleton is held equal to. The bottom row is the same component without the caption, 12px shorter; that delta is asserted too, so the choice of which variant to mirror stays a decision rather than a stale comment.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const skeleton = rowHeight(canvas.getByTestId('skeleton'))

    expect(skeleton).toBe(rowHeight(canvas.getByTestId('pantry-row-needed')))
    // Pins the variant the skeleton knowingly does not mirror. If the caption
    // stopped being optional — or grew a `gap-*` — this is what fails.
    expect(rowHeight(canvas.getByTestId('pantry-row'))).toBe(skeleton - 12)
  },
}
