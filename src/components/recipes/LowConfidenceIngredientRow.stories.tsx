import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import {
  createIngredientAlternative,
  createLowConfidenceIngredientRowData,
} from '@/stories/fixtures'
import { LowConfidenceIngredientRow } from './LowConfidenceIngredientRow'

const meta = {
  title: 'Feature/Recipes/LowConfidenceIngredientRow',
  component: LowConfidenceIngredientRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    data: createLowConfidenceIngredientRowData(),
    servings: 4,
    disabled: false,
    onUpdate: fn(),
    onRemove: fn(),
    onQuantityChange: fn(),
    onSetQuantity: fn(),
    onMarkAsVague: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LowConfidenceIngredientRow>

export default meta
type Story = StoryObj<typeof meta>

export const WithAlternatives: Story = {}

export const WithoutAlternatives: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({ alternatives: [] }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'No alternatives returned — the Select only exposes the best match and the user can Confirm.',
      },
    },
  },
}

export const Vague: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({
      isVague: true,
      originalPhrase: 'a splash',
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Vague quantity ("to taste" / "a splash") renders the italic original phrase instead of the per-serving amount.',
      },
    },
  },
}

export const InvalidQuantity: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({ totalQuantity: 0 }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Zero quantity surfaces the destructive "Quantity must be greater than 0" error.',
      },
    },
  },
}

export const Duplicate: Story = {
  args: {
    duplicateIndices: [0, 2],
    data: createLowConfidenceIngredientRowData(),
  },
  parameters: {
    docs: {
      description: {
        story: 'This ingredient is also used in rows 1 and 3 — shows the amber duplicate warning.',
      },
    },
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const WithOriginalText: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({
      originalText: '1 lb chicken thighs, bone-in',
    }),
  },
  parameters: {
    docs: {
      description: {
        story: 'Renders the raw extractor input alongside the resolved ingredient.',
      },
    },
  },
}

// Play stories — verify `onUpdate` / `onRemove` contracts under
// @storybook/test-runner. Radix Select content renders through a portal outside
// `canvasElement`, so option queries go through `within(document.body)`.

export const SelectingAlternativeInvokesOnUpdate: Story = {
  args: {
    data: createLowConfidenceIngredientRowData({
      alternatives: [
        createIngredientAlternative({
          id: 'chicken-breast',
          name: 'Chicken breast',
          category: 'protein',
          defaultUnit: 'g',
          similarity: 0.82,
        }),
      ],
    }),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: /verify ingredient match/i })
    await userEvent.click(trigger)

    const body = within(document.body)
    const option = await body.findByRole('option', { name: /chicken breast/i })
    await userEvent.click(option)

    await expect(args.onUpdate).toHaveBeenCalledTimes(1)
    await expect(args.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'matched',
        ingredient: expect.objectContaining({ id: 'chicken-breast', name: 'Chicken breast' }),
        totalQuantity: 600,
      }),
    )
  },
}

export const ConfirmBestMatchInvokesOnUpdate: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const confirm = canvas.getByRole('button', { name: /^confirm$/i })
    await userEvent.click(confirm)

    await expect(args.onUpdate).toHaveBeenCalledTimes(1)
    await expect(args.onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'matched',
        ingredient: expect.objectContaining({ id: 'chicken-thigh' }),
        totalQuantity: 600,
      }),
    )
  },
}

export const RemoveInvokesOnRemove: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const remove = canvas.getByRole('button', { name: /remove ingredient/i })
    await userEvent.click(remove)
    await expect(args.onRemove).toHaveBeenCalledTimes(1)
  },
}
