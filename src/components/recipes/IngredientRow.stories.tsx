import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createLowConfidenceIngredientRowData,
  createMatchedIngredientRowData,
  createUnmatchedIngredientRowData,
} from '@/stories/fixtures'
import { IngredientRow } from './IngredientRow'

// Drive a controlled React input the way React expects — see the note in
// QuantityControls.stories for why `userEvent.type` / `fireEvent.change` both
// fall short on a fully-controlled number input under React 19.
function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const meta = {
  title: 'Feature/Recipes/IngredientRow',
  component: IngredientRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Dispatcher that renders one of `MatchedIngredientRow` (inline), `LowConfidenceIngredientRow`, or `UnmatchedIngredientRow` based on `data.type`. Each branch exercises its own sub-component surface — these stories verify the routing and the shared matched / duplicate / invalid / disabled variants.',
      },
    },
  },
  args: {
    data: createMatchedIngredientRowData(),
    servings: 4,
    disabled: false,
    onUpdate: fn(),
    onRemove: fn(),
    onResolve: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IngredientRow>

export default meta
type Story = StoryObj<typeof meta>

export const Matched: Story = {
  parameters: {
    docs: {
      description: {
        story: 'High-confidence match — green tile with the inline `QuantityControls` primitive.',
      },
    },
  },
}

export const LowConfidence: Story = {
  args: {
    data: createLowConfidenceIngredientRowData(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Ambiguous match — delegates to `LowConfidenceIngredientRow` (blue tile).',
      },
    },
  },
}

export const Unmatched: Story = {
  args: {
    data: createUnmatchedIngredientRowData(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Unresolvable row — delegates to `UnmatchedIngredientRow` (amber tile).',
      },
    },
  },
}

export const Vague: Story = {
  args: {
    data: createMatchedIngredientRowData({
      isVague: true,
      originalPhrase: 'a pinch',
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Vague matched row — renders the original phrase italicised and swaps the input for a "Set quantity" button.',
      },
    },
  },
}

export const InvalidQuantity: Story = {
  args: {
    data: createMatchedIngredientRowData({ totalQuantity: 0 }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Zero total quantity — surfaces the destructive error line under the ingredient.',
      },
    },
  },
}

export const Duplicate: Story = {
  args: {
    duplicateIndices: [0, 3],
    data: createMatchedIngredientRowData(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Ingredient is also used in rows 1 and 4 — shows the amber duplicate warning.',
      },
    },
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const PieceUnit: Story = {
  args: {
    data: createMatchedIngredientRowData({
      ingredient: {
        id: 'lemon',
        name: 'Lemon',
        category: 'fruit',
        defaultUnit: 'piece',
        gramsPerPiece: 60,
      },
      totalQuantity: 2,
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Piece-unit ingredient renders the per-serving amount without a unit suffix.',
      },
    },
  },
}

// Play story — verify the matched-row quantity flow wires through the
// dispatcher's `handleQuantityChange` into `onUpdate`.
export const MatchedQuantityChangeInvokesOnUpdate: Story = {
  args: {
    data: createMatchedIngredientRowData({ totalQuantity: 600 }),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('spinbutton', { name: /quantity/i }) as HTMLInputElement
    setInputValue(input, '800')
    await expect(args.onUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'matched',
        totalQuantity: 800,
        isVague: false,
        originalPhrase: null,
      }),
    )
  },
}

export const MatchedRemoveInvokesOnRemove: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const removeButton = canvas.getByRole('button', { name: /remove ingredient/i })
    await userEvent.click(removeButton)
    await expect(args.onRemove).toHaveBeenCalledTimes(1)
  },
}
