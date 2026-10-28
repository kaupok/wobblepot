import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createIngredient, createMealComponent } from '@/stories/fixtures'
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
          'A planned entry’s own ingredient changes (HON-1243): a replaced row names the original under it, a left-out row stays, struck through, an added row names “Added” under it, and a change the recipe no longer fits says so. Each has Undo while the entry is planned; a cooked or skipped entry shows them read-only.',
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

/**
 * "Added" is a muted line under the name, as "Instead of …" is on a replaced
 * row, not a badge beside it (HON-1370). Undo alone ends the row.
 */
export const Added: Story = {
  args: {
    components: [salmon, potato, lemon, rice],
    changes: [added, replaced],
    changeControls: controls(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // 4 servings × 80 g.
    await expect(canvas.getByText('320g')).toBeVisible()
    const label = canvas.getByText('Added')
    await expect(label).toBeVisible()
    await expect(label.parentElement).toBe(canvas.getByText('Short-grain rice').parentElement)
    await expect(label.className).toBe(canvas.getByText('Instead of Chicken thigh').className)
    await expect(canvasElement.querySelector('[data-slot="badge"]')).toBeNull()
    const undo = canvas.getByRole('button', { name: 'Undo change: Short-grain rice' })
    await expect(undo).toBeVisible()
    await expect(undo.closest('li')!.lastElementChild).toBe(undo)
  },
}

const longAdded = createMealComponent({
  ingredientId: 'long-added',
  quantityPerServing: 50,
  ingredient: createIngredient({
    id: 'long-added',
    name: 'Täisrasvakreekajogurtikaste',
  }),
})
const longChanges: EntryChange[] = [
  {
    id: 'change-long-add',
    original: null,
    replacement: { id: 'long-added', name: 'Täisrasvakreekajogurtikaste' },
    quantityPerServing: 50,
    stale: false,
  },
  {
    id: 'change-long-replace',
    original: { id: 'chicken-thigh', name: 'Kanakintsufileetükikesed' },
    replacement: { id: 'salmon-fillet', name: 'Salmon fillet' },
    quantityPerServing: 140,
    stale: false,
  },
  {
    id: 'change-long-leave-out',
    original: { id: 'garlic', name: 'Suitsuküüslauguküüntekarp' },
    replacement: null,
    quantityPerServing: null,
    stale: false,
  },
]

/**
 * Names with no break point, as an Estonian compound word has, at the 390px
 * default viewport: each wraps inside its own column, so no text runs under
 * Undo in an added, replaced or left-out row (HON-1370).
 */
export const LongNamesWrap: Story = {
  args: {
    components: [salmon, potato, lemon, longAdded],
    changes: longChanges,
    changeControls: controls(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const undo of canvas.getAllByRole('button', { name: /^Undo change/ })) {
      const row = undo.closest('li')!
      // A range covers the text itself, so text that overflows its box counts.
      const text = document.createRange()
      text.selectNodeContents(row.firstElementChild!)
      const u = undo.getBoundingClientRect()
      await expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(u.left)
      await expect(u.right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 0.5)
    }
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

/**
 * Each unchanged row's menu offers Replace and Leave out, each 16px text in a
 * row of 44px or more (HON-1359), and "Add an ingredient" calls `onAdd`.
 */
export const RowMenu: Story = {
  args: { changes: [], changeControls: controls() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change Potato' }))
    const menu = await within(document.body).findByRole('menu')
    for (const item of within(menu).getAllByRole('menuitem')) {
      // `offsetHeight`, not the rect: the menu scales in from 95%.
      await expect(item.offsetHeight).toBeGreaterThanOrEqual(44)
      await expect(getComputedStyle(item).fontSize).toBe('16px')
    }
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Leave out' }))
    await expect(args.changeControls!.onLeaveOut).toHaveBeenCalledWith(potato)
    await userEvent.click(canvas.getByRole('button', { name: 'Add an ingredient' }))
    await expect(args.changeControls!.onAdd).toHaveBeenCalledTimes(1)
  },
}

/**
 * "Add" ends the Ingredients heading line, after the to-buy status, and is
 * named "Add an ingredient" (HON-1357). At the 390px default viewport the
 * heading, the status and the button share one line; the list holds no button.
 */
export const AddOnHeadingLine: Story = {
  args: {
    changes: [],
    changeControls: controls(),
    availability: {
      isReady: false,
      missingCount: 7,
      missingIngredients: ['Salmon fillet', 'Potato', 'Lemon', 'Dill', 'Leek', 'Cream', 'Butter'],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Add an ingredient' })
    await expect(button).toHaveTextContent(/^Add$/)
    const heading = canvas.getByRole('heading', { name: 'Ingredients' })
    const line = heading.parentElement!.parentElement!
    await expect(button.parentElement).toBe(line)
    await expect(canvas.getByText('7 to buy')).toBeVisible()
    // One line: the button is centred on the heading and ends at the line's
    // right edge.
    const h = heading.getBoundingClientRect()
    const b = button.getBoundingClientRect()
    await expect(Math.abs(b.top + b.height / 2 - (h.top + h.height / 2))).toBeLessThanOrEqual(1)
    await expect(Math.round(b.right)).toBe(Math.round(line.getBoundingClientRect().right))
    await expect(
      within(canvas.getByRole('list')).queryByRole('button', { name: /^Add/ }),
    ).toBeNull()
    await userEvent.click(button)
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
