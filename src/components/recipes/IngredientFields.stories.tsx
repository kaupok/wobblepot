import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { speltPasta } from '@/components/household/ingredient-fixtures'
import {
  IngredientFields,
  useIngredientDraft,
  type IngredientDraftInitial,
} from './IngredientFields'

function IngredientFieldsHarness({ initial }: { initial: IngredientDraftInitial }) {
  const draft = useIngredientDraft(initial)
  return (
    <div className="flex max-w-md flex-col gap-4">
      <IngredientFields draft={draft} />
      <button type="button" onClick={() => draft.validate()}>
        Check
      </button>
    </div>
  )
}

const meta = {
  title: 'Feature/Recipes/IngredientFields',
  component: IngredientFieldsHarness,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The fields of a household ingredient, shared by "Add as new ingredient" (HON-1263) and the Ingredients tab\'s Edit (HON-1264). The caller owns the heading, the buttons and the request; `useIngredientDraft` owns the values and the checks. The Check button stands in for a caller\'s Save.',
      },
    },
  },
  args: { initial: { name: 'lovage' } },
} satisfies Meta<typeof IngredientFieldsHarness>

export default meta
type Story = StoryObj<typeof meta>

/** From a recipe name alone, as "Add as new ingredient" starts. */
export const FromARecipeName: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Name')).toHaveValue('lovage')
    await userEvent.click(canvas.getByRole('button', { name: 'Check' }))
    await expect(canvas.getByRole('combobox', { name: 'Category' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  },
}

/** From a saved row, as Edit starts. */
export const FromASavedRow: Story = {
  args: { initial: speltPasta },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Name')).toHaveValue('spelt pasta')
    await expect(canvas.getByRole('button', { name: 'Gluten' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}
