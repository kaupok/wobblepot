import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { createCustomItem, createShoppingItem } from '@/stories/fixtures'
import { CustomShoppingItem } from './CustomShoppingItem'
import { ShoppingItem } from './ShoppingItem'
import { ShoppingItemSkeleton } from './ShoppingItemSkeleton'

/** Rounded so sub-pixel noise can't fail the comparison; 1px of drift still does. */
function rowHeight(element: HTMLElement): number {
  return Math.round(element.getBoundingClientRect().height)
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
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ShoppingItemSkeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AgainstLiveRows: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div data-testid="skeleton">
        <ShoppingItemSkeleton />
      </div>
      <div data-testid="shopping-item">
        <ShoppingItem item={createShoppingItem()} onToggle={fn()} />
      </div>
      <div data-testid="custom-item">
        <CustomShoppingItem
          item={createCustomItem()}
          onToggle={fn()}
          onUnlink={fn()}
          onDelete={fn()}
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The skeleton above the two row types it replaces. `ShoppingItem` and `CustomShoppingItem` share the same `min-h-touch … rounded-lg border p-3` box, so one skeleton covers both — the play function holds all three to the same height rather than to a hardcoded number, so a deliberate row redesign keeps the guard while a one-sided change breaks it.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const skeleton = rowHeight(canvas.getByTestId('skeleton'))

    expect(skeleton).toBe(rowHeight(canvas.getByTestId('shopping-item')))
    expect(skeleton).toBe(rowHeight(canvas.getByTestId('custom-item')))
  },
}
