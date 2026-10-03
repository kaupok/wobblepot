import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { createCustomItem, createShoppingItem } from '@/stories/fixtures'
import { Card, CardContent } from '@/components/ui/card'
import { RowGroup } from '@/components/ui/row-group'
import { CustomShoppingItem } from './CustomShoppingItem'
import { ShoppingItem } from './ShoppingItem'
import { ShoppingItemSkeleton } from './ShoppingItemSkeleton'

/** Rounded so sub-pixel noise can't fail the comparison; 1px of drift still does. */
function rowHeight(element: HTMLElement): number {
  return Math.round(element.getBoundingClientRect().height)
}

/**
 * The row is 36px with a mouse and 44px on touch (HON-1017). The CI browser has
 * a fine pointer, so CI measures the 36px box; a touch-emulated browser
 * (`hasTouch`) measures the 44px one against the same assertion.
 */
function expectedRowHeight(): number {
  return window.matchMedia('(pointer: fine)').matches ? 36 : 44
}

const meta = {
  title: 'Feature/Shopping/ShoppingItemSkeleton',
  component: ShoppingItemSkeleton,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The placeholder `/shopping` shows for each shopping row while the list loads. The story stacks it on the live rows it stands in for and asserts they measure the same height — the component's entire contract, and one no class-string test can see: the 14px desync HON-628 fixed had been on `main` since PR #326 with both class strings looking perfectly reasonable.",
      },
    },
  },
  // The rows live on the shopping note's sheet, ruled rather than boxed (HON-1016).
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Card data-surface="note">
          <CardContent>
            <Story />
          </CardContent>
        </Card>
      </div>
    ),
  ],
} satisfies Meta<typeof ShoppingItemSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <RowGroup variant="ruled">
      <ShoppingItemSkeleton />
      <ShoppingItemSkeleton />
      <ShoppingItemSkeleton />
    </RowGroup>
  ),
}

export const AgainstLiveRows: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <RowGroup variant="ruled" data-testid="skeleton">
        <ShoppingItemSkeleton />
      </RowGroup>
      <RowGroup variant="ruled" data-testid="shopping-item">
        <ShoppingItem item={createShoppingItem()} onToggle={fn()} />
      </RowGroup>
      <RowGroup variant="ruled" data-testid="custom-item">
        <CustomShoppingItem
          item={createCustomItem()}
          onToggle={fn()}
          onUnlink={fn()}
          onDelete={fn()}
        />
      </RowGroup>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The skeleton above the two row types it replaces. `ShoppingItem` and `CustomShoppingItem` share the same `min-h-touch px-3 py-2 pointer-fine:min-h-9 pointer-fine:py-1` box inside a ruled `RowGroup`, so one skeleton covers both. The play function holds all three to the same height, so a one-sided change breaks it, and to the height for the pointer type: 36px with a mouse, 44px on touch (HON-1017).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const skeleton = rowHeight(canvas.getByTestId('skeleton'))

    await expect(skeleton).toBe(expectedRowHeight())
    await expect(rowHeight(canvas.getByTestId('shopping-item'))).toBe(skeleton)
    await expect(rowHeight(canvas.getByTestId('custom-item'))).toBe(skeleton)
  },
}
