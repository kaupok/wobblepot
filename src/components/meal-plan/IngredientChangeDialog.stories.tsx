import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createMealComponent, ingredientResults } from '@/stories/fixtures'
import { IngredientChangeDialog } from './IngredientChangeDialog'

const chicken = createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 })

const meta = {
  title: 'Meal plan/IngredientChangeDialog',
  component: IngredientChangeDialog,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Replace one ingredient of a planned entry, or add one (HON-1243): pick it in the ingredient search, then enter the amount for the entry’s servings. The amount is prefilled from the original only when both are counted the same way.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    original: chicken,
    servings: 4,
    existingIngredientIds: ['chicken-thigh', 'potato'],
    isSubmitting: false,
    onSubmit: fn(async () => true),
  },
} satisfies Meta<typeof IngredientChangeDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Types `term` into the ingredient search and picks the option named `name`. */
async function pick(term: string, name: RegExp) {
  const body = within(document.body)
  await userEvent.type(await body.findByRole('combobox'), term)
  await userEvent.click(await body.findByRole('option', { name }))
}

/** Grams for grams: the original's amount for 4 servings is prefilled. */
export const ReplaceSameUnit: Story = {
  play: async ({ args }) => {
    const body = within(document.body)
    // Found by its title; the open animation starts at opacity 0.
    await body.findByRole('dialog', { name: 'Replace: Chicken thigh' })
    await pick('salm', /^Salmon fillet/)
    const amount = await body.findByLabelText('Amount for 4 servings')
    await expect(amount).toHaveValue('600')
    await userEvent.click(body.getByRole('button', { name: 'Replace' }))
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ id: ingredientResults['salmon-fillet'].id }),
        150,
      ),
    )
  },
}

/** Pieces for grams: no number is guessed, and Replace waits for one. */
export const ReplaceDifferentUnit: Story = {
  play: async () => {
    const body = within(document.body)
    await pick('lem', /^Lemon/)
    await expect(await body.findByLabelText('Amount for 4 servings')).toHaveValue('')
    await expect(body.getByText('The units differ, so enter the amount.')).toBeVisible()
    await expect(body.getByRole('button', { name: 'Replace' })).toBeDisabled()
  },
}

export const Add: Story = {
  args: { original: null },
  play: async ({ args }) => {
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Add an ingredient' })
    await pick('lem', /^Lemon/)
    const amount = await body.findByLabelText('Amount for 4 servings')
    await userEvent.type(amount, '2')
    await userEvent.click(body.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(args.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 'lemon' }), 0.5),
    )
  },
}
