import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createPantryItemData } from '@/stories/fixtures'
import { PantryItem } from './PantryItem'

const meta = {
  title: 'Feature/Pantry/PantryItem',
  component: PantryItem,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Single pantry row — renders the ingredient name with a staple star-toggle on the left and a destructive remove button on the right. Remove is gated by a `ConfirmDialog`.',
      },
    },
  },
  args: {
    item: createPantryItemData(),
    onToggleStaple: fn(),
    onRemove: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PantryItem>

export default meta
type Story = StoryObj<typeof meta>

export const OnHand: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Default — an on-hand (non-staple) item. The star is hollow; clicking it toggles the item into the staple list.',
      },
    },
  },
}

export const Staple: Story = {
  args: {
    item: createPantryItemData({
      ingredient: {
        id: 'salt',
        name: 'Salt',
        category: 'condiment',
        defaultUnit: 'g',
      },
      isStaple: true,
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Staple row — the star is filled yellow and the `aria-label` reads "Remove from staples".',
      },
    },
  },
}

export const LongName: Story = {
  args: {
    item: createPantryItemData({
      ingredient: {
        id: 'long-ingredient',
        name: 'Organic cold-pressed extra-virgin olive oil from a small family farm',
        category: 'fat',
        defaultUnit: 'g',
      },
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Stress-test for overflow behaviour on a very long ingredient name.',
      },
    },
  },
}

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <PantryItem
        item={createPantryItemData({
          ingredient: {
            id: 'salt',
            name: 'Salt',
            category: 'condiment',
            defaultUnit: 'g',
          },
          isStaple: true,
        })}
        onToggleStaple={fn()}
        onRemove={fn()}
      />
      <PantryItem
        item={createPantryItemData({
          ingredient: {
            id: 'chicken-thigh',
            name: 'Chicken thigh',
            category: 'protein',
            defaultUnit: 'g',
          },
          quantity: 500,
        })}
        onToggleStaple={fn()}
        onRemove={fn()}
      />
      <PantryItem
        item={createPantryItemData({
          ingredient: {
            id: 'short-grain-rice',
            name: 'Short-grain rice',
            category: 'carb',
            defaultUnit: 'g',
          },
        })}
        onToggleStaple={fn()}
        onRemove={fn()}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Staple + two on-hand rows stacked — side-by-side visual review of the star + name + remove-button triad.',
      },
    },
  },
}

// Play story — clicking the star invokes `onToggleStaple` with the item id and
// its current `isStaple` value so the parent can flip the state.
export const ToggleStapleInvokesCallback: Story = {
  args: {
    item: createPantryItemData({
      id: 'pantry-oil',
      ingredient: {
        id: 'olive-oil',
        name: 'Olive oil',
        category: 'fat',
        defaultUnit: 'g',
      },
    }),
    onToggleStaple: fn(),
    onRemove: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const starButton = canvas.getByRole('button', { name: /mark as staple/i })
    await userEvent.click(starButton)
    await waitFor(() => expect(args.onToggleStaple).toHaveBeenCalledWith('pantry-oil', false))
  },
}

// Play story — the remove button opens a Radix `ConfirmDialog` rendered in a
// portal, so we query `document.body` instead of the story canvas.
export const RemoveOpensConfirmDialog: Story = {
  args: {
    item: createPantryItemData({
      id: 'pantry-oil',
      ingredient: {
        id: 'olive-oil',
        name: 'Olive oil',
        category: 'fat',
        defaultUnit: 'g',
      },
    }),
    onRemove: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const removeButton = canvas.getByRole('button', { name: /remove olive oil/i })
    await userEvent.click(removeButton)
    const body = within(document.body)
    await body.findByRole('alertdialog')
    await body.findByText(/are you sure you want to remove olive oil/i)
    // The dialog is a gate — clicking the trigger itself does not fire `onRemove`.
    await expect(args.onRemove).not.toHaveBeenCalled()
  },
}

export const ConfirmRemoveInvokesCallback: Story = {
  args: {
    item: createPantryItemData({
      id: 'pantry-oil',
      ingredient: {
        id: 'olive-oil',
        name: 'Olive oil',
        category: 'fat',
        defaultUnit: 'g',
      },
    }),
    onRemove: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /remove olive oil/i }))
    const body = within(document.body)
    const confirm = await body.findByRole('button', { name: /^remove$/i })
    await userEvent.click(confirm)
    await waitFor(() => expect(args.onRemove).toHaveBeenCalledWith('pantry-oil'))
  },
}

export const CancelRemoveIsNoOp: Story = {
  args: {
    item: createPantryItemData({
      id: 'pantry-oil',
      ingredient: {
        id: 'olive-oil',
        name: 'Olive oil',
        category: 'fat',
        defaultUnit: 'g',
      },
    }),
    onRemove: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /remove olive oil/i }))
    const body = within(document.body)
    const cancel = await body.findByRole('button', { name: /cancel/i })
    await userEvent.click(cancel)
    await waitFor(() =>
      expect(body.queryByRole('alertdialog', { hidden: false })).not.toBeInTheDocument(),
    )
    await expect(args.onRemove).not.toHaveBeenCalled()
  },
}
