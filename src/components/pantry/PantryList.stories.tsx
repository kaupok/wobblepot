import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { createPantryItemData, defaultPantryItems } from '@/stories/fixtures'
import { PantryList } from './PantryList'

const meta = {
  title: 'Feature/Pantry/PantryList',
  component: PantryList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Top-level pantry surface — renders staples and on-hand items in separate sections, with an inline add-ingredient combobox on top. Toggle-staple, remove, and add flows mutate optimistic state backed by MSW `/api/pantry/*` handlers.',
      },
    },
  },
  args: {
    initialItems: defaultPantryItems,
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PantryList>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { initialItems: [] },
  parameters: {
    docs: {
      description: {
        story: 'No items — renders the empty-state copy plus the inline add-ingredient input.',
      },
    },
  },
}

export const StaplesOnly: Story = {
  args: {
    initialItems: [
      createPantryItemData({
        ingredient: { id: 'salt', name: 'Salt', category: 'condiment', defaultUnit: 'g' },
        isStaple: true,
      }),
      createPantryItemData({
        ingredient: {
          id: 'olive-oil',
          name: 'Olive oil',
          category: 'fat',
          defaultUnit: 'g',
        },
        isStaple: true,
      }),
    ],
  },
}

export const OnHandOnly: Story = {
  args: {
    initialItems: [
      createPantryItemData({
        ingredient: {
          id: 'chicken-thigh',
          name: 'Chicken thigh',
          category: 'protein',
          defaultUnit: 'g',
        },
        quantity: 500,
      }),
    ],
  },
}

export const Singular: Story = {
  args: {
    initialItems: [
      createPantryItemData({
        ingredient: {
          id: 'chicken-thigh',
          name: 'Chicken thigh',
          category: 'protein',
          defaultUnit: 'g',
        },
        quantity: 500,
      }),
    ],
  },
  parameters: {
    docs: {
      description: {
        story: 'Exercises the "1 item" singular label (vs. "N items" plural).',
      },
    },
  },
}

export const Mixed: Story = {
  args: { initialItems: defaultPantryItems },
  parameters: {
    docs: {
      description: {
        story:
          'Default fixture — two staples (Salt, Garlic) and two on-hand items (Chicken thigh, Short-grain rice). Both sections render with plural "items" counts.',
      },
    },
  },
}

// Play story — clicking the star on a staple flips it into the on-hand group.
// The optimistic `setItems` update is synchronous; MSW PATCH resolves ok so no
// rollback happens.
export const ToggleStapleMovesBetweenGroups: Story = {
  args: {
    initialItems: [
      createPantryItemData({
        id: 'pantry-salt',
        ingredient: { id: 'salt', name: 'Salt', category: 'condiment', defaultUnit: 'g' },
        isStaple: true,
      }),
      createPantryItemData({
        id: 'pantry-chicken',
        ingredient: {
          id: 'chicken-thigh',
          name: 'Chicken thigh',
          category: 'protein',
          defaultUnit: 'g',
        },
        quantity: 500,
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Salt starts as a staple — its button reads "Remove from staples".
    const stapleStar = canvas.getByRole('button', { name: /remove from staples/i })
    await userEvent.click(stapleStar)

    // After the optimistic update, both rows sit in the "On hand" section and
    // no "Staples" header is rendered.
    await waitFor(() => {
      expect(canvas.queryByText(/staples \(always stocked\)/i)).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(canvas.getByText(/on hand/i)).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(canvas.getByText('2 items')).toBeInTheDocument()
    })
  },
}

// Play story — the remove flow lives on `PantryItem` but the row disappears
// from the list only once the parent's optimistic `setItems` fires.
export const RemoveViaDialogRemovesItem: Story = {
  args: {
    initialItems: [
      createPantryItemData({
        id: 'pantry-chicken',
        ingredient: {
          id: 'chicken-thigh',
          name: 'Chicken thigh',
          category: 'protein',
          defaultUnit: 'g',
        },
        quantity: 500,
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /remove chicken thigh/i }))

    const body = within(document.body)
    const confirm = await body.findByRole('button', { name: /^remove$/i })
    await userEvent.click(confirm)

    await waitFor(() => {
      expect(canvas.queryByText('Chicken thigh')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(canvas.getByText(/your pantry is empty/i)).toBeInTheDocument()
    })
  },
}

// Play story — typing in the inline add-ingredient combobox, picking a result,
// and watching the row append to the "On hand" section via the MSW-backed POST.
export const AddItemViaInlineSearchAppendsRow: Story = {
  args: {
    initialItems: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.type(input, 'chick')

    const option = await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.click(option)

    await waitFor(() => {
      expect(canvas.getByText(/on hand/i)).toBeInTheDocument()
    })
    await waitFor(() => {
      // The newly added row renders in the canvas — there's no dropdown at
      // this point (input clears on success), so matching on the row text is
      // safe.
      expect(canvas.getAllByText('Chicken thigh').length).toBeGreaterThan(0)
    })
  },
}
