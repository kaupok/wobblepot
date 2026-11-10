import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'

import { RowGroup } from '@/components/ui/row-group'
import { createPantryItemData } from '@/stories/fixtures'

import { PantryItemRow } from './PantryItemRow'
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
          'The placeholder `/shopping` shows for each pantry row while the list loads. Same contract as `ShoppingItemSkeleton` — the play function measures it against the live row — but against `PantrySection`\'s `PantryItemRow`, which is what the screen renders. (`components/pantry/PantryItem.tsx` reads like the counterpart and is not one: it has no callsite outside its own story and test.) A pantry row has no `min-h-touch` floor: its height comes from the name line (the name beside its two `icon-sm` buttons), the "needed in window" caption, and the stock control. A row 28rem wide puts the control on the name line; a narrower one puts it under the caption. The skeleton uses the same `@container` breakpoint, so both layouts are measured.',
      },
    },
  },
} satisfies Meta<typeof PantryItemRowSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <RowGroup>
      <PantryItemRowSkeleton />
      <PantryItemRowSkeleton />
      <PantryItemRowSkeleton />
    </RowGroup>
  ),
}

function AgainstLiveRows() {
  return (
    <div className="flex flex-col gap-2">
      <RowGroup data-testid="skeleton">
        <PantryItemRowSkeleton />
      </RowGroup>
      <RowGroup data-testid="pantry-row-needed">
        <PantryItemRow
          item={createPantryItemData({
            neededQuantity: 500,
            neededDisplayQuantity: '500g',
            windowDays: 7,
          })}
          onToggleStaple={noop}
          onRemove={noop}
          onHaveIt={noop}
          onRanOut={noop}
          onSetLow={noop}
        />
      </RowGroup>
      <RowGroup data-testid="pantry-row">
        <PantryItemRow
          item={createPantryItemData()}
          onToggleStaple={noop}
          onRemove={noop}
          onHaveIt={noop}
          onRanOut={noop}
          onSetLow={noop}
        />
      </RowGroup>
    </div>
  )
}

/**
 * The skeleton matches the row with the caption, and the row without it is
 * 20px shorter. That delta is asserted too, so the choice of which variant to
 * mirror stays a decision rather than a stale comment.
 */
async function expectSkeletonMatches(canvasElement: HTMLElement, height: number) {
  const canvas = within(canvasElement)
  const skeleton = rowHeight(canvas.getByTestId('skeleton'))
  expect(skeleton).toBe(height)
  expect(rowHeight(canvas.getByTestId('pantry-row-needed'))).toBe(skeleton)
  // If the caption stopped being optional — or grew a `gap-*` — this fails.
  expect(rowHeight(canvas.getByTestId('pantry-row'))).toBe(skeleton - 20)
}

export const AgainstLiveRow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
  render: () => <AgainstLiveRows />,
  parameters: {
    docs: {
      description: {
        story:
          'A phone-width row: the stock control sits under the caption, lined up with the name, and ⋯ stays on the name line. The skeleton above both variants of the row it replaces, each in its own `RowGroup`, which is where the border lives. The middle row is the one whose ingredient the plan needs — the variant this route serves, and the one the skeleton is held equal to.',
      },
    },
  },
  // 32px name line + 20px caption + 8px + 28px control + 24px padding, and
  // the `RowGroup`'s 1px borders.
  play: async ({ canvasElement }) => expectSkeletonMatches(canvasElement, 114),
}

export const AgainstLiveRowWide: Story = {
  decorators: [
    (Story) => (
      <div className="w-3xl">
        <Story />
      </div>
    ),
  ],
  render: () => <AgainstLiveRows />,
  parameters: {
    docs: {
      description: {
        story:
          'A desktop-width row: the stock control sits on the name line, before ⋯, so a row with a need is two lines.',
      },
    },
  },
  // 32px name line + 20px caption + 24px padding + the 1px borders.
  play: async ({ canvasElement }) => expectSkeletonMatches(canvasElement, 78),
}
