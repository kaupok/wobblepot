import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createMealComponent } from '@/stories/fixtures'
import { IngredientList } from './IngredientList'
import type { EntryChange } from './types'

// One planned dinner with every kind of change (HON-1243). `components` is
// what the server sends: the changes already merged, so the salmon stands
// where the chicken was, the rice is appended, and the garlic is gone.
const replaced: EntryChange = {
  id: 'change-replace',
  original: { id: 'chicken-thigh', name: 'Chicken thigh' },
  replacement: { id: 'salmon-fillet', name: 'Salmon fillet' },
  quantityPerServing: 140,
  stale: false,
}
const leftOut: EntryChange = {
  id: 'change-leave-out',
  original: { id: 'garlic', name: 'Garlic' },
  replacement: null,
  quantityPerServing: null,
  stale: false,
}
const added: EntryChange = {
  id: 'change-add',
  original: null,
  replacement: { id: 'short-grain-rice', name: 'Short-grain rice' },
  quantityPerServing: 80,
  stale: false,
}
// The recipe was edited after this change, so it does nothing.
const stale: EntryChange = {
  id: 'change-stale',
  original: { id: 'miso-paste', name: 'White miso' },
  replacement: null,
  quantityPerServing: null,
  stale: true,
}

const salmon = createMealComponent({ ingredientId: 'salmon-fillet', quantityPerServing: 140 })
const potato = createMealComponent({ ingredientId: 'potato', quantityPerServing: 200 })
const lemon = createMealComponent({ ingredientId: 'lemon', quantityPerServing: 0.5 })
const rice = createMealComponent({ ingredientId: 'short-grain-rice', quantityPerServing: 80 })

const controls = () => ({
  onReplace: fn(),
  onLeaveOut: fn(),
  onAdd: fn(),
  onUndo: fn(),
})

const meta = {
  title: 'Meal plan/IngredientList/Changes',
  component: IngredientList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A planned entry’s own ingredient changes (HON-1243): a replaced row names the original under it, a left-out row stays, struck through, an added row carries “Added”, and a change the recipe no longer fits says so. Each has Undo while the entry is planned; a cooked or skipped entry shows them read-only.',
      },
    },
  },
  args: { servings: 4, householdServings: 4, components: [salmon, potato, lemon] },
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IngredientList>

export default meta
type Story = StoryObj<typeof meta>

export const Replaced: Story = {
  args: { changes: [replaced], changeControls: controls() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Salmon fillet')).toBeVisible()
    await expect(canvas.getByText('Instead of Chicken thigh')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Undo change: Salmon fillet' }))
    await expect(args.changeControls!.onUndo).toHaveBeenCalledWith(replaced)
  },
}

export const LeftOut: Story = {
  args: { changes: [leftOut], changeControls: controls() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByText('Garlic')
    await expect(getComputedStyle(name).textDecorationLine).toBe('line-through')
    await expect(canvas.getByText('Left out')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Undo change: Garlic' }))
    await expect(args.changeControls!.onUndo).toHaveBeenCalledWith(leftOut)
  },
}

export const Added: Story = {
  args: {
    components: [salmon, potato, lemon, rice],
    changes: [added],
    changeControls: controls(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // 4 servings × 80 g.
    await expect(canvas.getByText('320g')).toBeVisible()
    await expect(canvas.getByText('Added')).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Undo change: Short-grain rice' }),
    ).toBeVisible()
  },
}

export const Stale: Story = {
  args: { changes: [stale], changeControls: controls() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No longer fits the recipe')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Undo change: White miso' })).toBeVisible()
  },
}

/** Each unchanged row's menu offers Replace and Leave out, and the list ends on "Add an ingredient". */
export const RowMenu: Story = {
  args: { changes: [], changeControls: controls() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change Potato' }))
    const body = within(document.body)
    await userEvent.click(await body.findByRole('menuitem', { name: 'Leave out' }))
    await expect(args.changeControls!.onLeaveOut).toHaveBeenCalledWith(potato)
    await userEvent.click(canvas.getByRole('button', { name: 'Add an ingredient' }))
    await expect(args.changeControls!.onAdd).toHaveBeenCalledTimes(1)
  },
}

/** A cooked or skipped entry: the changes stay visible, with no menu, Undo or "Add an ingredient". */
export const ReadOnly: Story = {
  args: {
    components: [salmon, potato, lemon, rice],
    changes: [replaced, leftOut, added, stale],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Instead of Chicken thigh')).toBeVisible()
    await expect(canvas.getByText('Left out')).toBeVisible()
    await expect(canvas.getByText('Added')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Undo/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Change / })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Add an ingredient' })).toBeNull()
  },
}
