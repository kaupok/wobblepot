import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { SampleShoppingList } from './SampleShoppingList'

const meta = {
  title: 'Meal plans/SampleShoppingList',
  component: SampleShoppingList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "A public sample week's shopping list (`/meal-plans/<slug>`, HON-1085): every ingredient of the seven dinners summed for the page's household, grouped by category in the real list's order, on the shopping note sheet. Read-only, with no pantry deduction.",
      },
    },
  },
  args: {
    groups: [
      {
        category: 'protein',
        items: [
          { id: 'mince', name: 'beef mince', quantity: '900g', isVague: false },
          { id: 'salmon', name: 'salmon fillet', quantity: '450g', isVague: false },
          { id: 'chicken', name: 'chicken thigh', quantity: '1.1kg', isVague: false },
        ],
      },
      {
        category: 'vegetable',
        items: [
          { id: 'onion', name: 'onion', quantity: '5 pc', isVague: false },
          { id: 'pepper', name: 'bell pepper', quantity: '360g', isVague: false },
        ],
      },
      {
        category: 'dairy',
        items: [{ id: 'milk', name: 'milk', quantity: '600ml', isVague: false }],
      },
      {
        category: 'spice',
        items: [
          { id: 'salt', name: 'salt', quantity: 'some', isVague: true },
          { id: 'pepper-black', name: 'black pepper', quantity: 'to taste', isVague: true },
        ],
      },
    ],
  },
} satisfies Meta<typeof SampleShoppingList>

export default meta
type Story = StoryObj<typeof meta>

/** Four categories, a vague quantity among them. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const headings = canvas.getAllByRole('heading', { level: 3 })
    await expect(headings.map((heading) => heading.textContent)).toEqual([
      '🥩Protein 3',
      '🥬Vegetables 2',
      '🧀Dairy 1',
      '🌿Spices 2',
    ])
    await expect(canvas.getByRole('list', { name: 'Protein 3' })).toBeVisible()
  },
}

/** One category: a week that needs only a few things. */
export const SingleCategory: Story = {
  args: {
    groups: [
      {
        category: 'carb',
        items: [{ id: 'pasta', name: 'pasta', quantity: '600g', isVague: false }],
      },
    ],
  },
}
