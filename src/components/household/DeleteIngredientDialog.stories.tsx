import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, within } from 'storybook/test'

import { DeleteIngredientDialog } from './DeleteIngredientDialog'
import { lovage } from './ingredient-fixtures'

const meta = {
  title: 'Feature/Household/DeleteIngredientDialog',
  component: DeleteIngredientDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Delete on the Ingredients tab (HON-1264), a `ConfirmDialog`. The route refuses a row anything still uses (409 `in_use`); the dialog then names each use with a count above zero, in catalog copy.',
      },
    },
  },
  args: {
    open: true,
    ingredient: lovage,
    onOpenChange: fn(),
  },
} satisfies Meta<typeof DeleteIngredientDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Confirm: Story = {
  play: async () => {
    await expect(
      await within(document.body).findByRole('alertdialog', { name: 'Delete ingredient: lovage?' }),
    ).toBeInTheDocument()
  },
}

export const InUse: Story = {
  parameters: {
    msw: {
      handlers: [
        http.delete('/api/ingredients/:id', () =>
          HttpResponse.json(
            {
              error: 'Ingredient in use',
              code: 'in_use',
              uses: {
                meals: 2,
                deletedMealsInPlan: 0,
                pantry: 1,
                shoppingList: 1,
                mealPlan: 3,
                extras: 1,
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Delete' }))

    await expect(
      await body.findByText(
        'lovage is still in use, so you cannot delete it: 2 recipes, the pantry, 1 shopping list item, 3 meal plan entries, 1 extra. Remove it from those first.',
      ),
    ).toBeInTheDocument()
  },
}

export const InUseEstonian: Story = {
  ...InUse,
  globals: { locale: 'et' },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Kustuta' }))

    await expect(
      await body.findByText(
        'lovage on veel kasutusel, seega ei saa seda kustutada: 2 retsepti, sahvris, 1 ostunimekirja rida, 3 söögiplaani kirjet, 1 lisa. Eemalda see enne sealt.',
      ),
    ).toBeInTheDocument()
  },
}

/** A deleted recipe a meal plan entry still uses (HON-1325): named apart, never as "1 recipe". */
export const InUseByDeletedRecipe: Story = {
  parameters: {
    msw: {
      handlers: [
        http.delete('/api/ingredients/:id', () =>
          HttpResponse.json(
            {
              error: 'Ingredient in use',
              code: 'in_use',
              uses: {
                meals: 0,
                deletedMealsInPlan: 1,
                pantry: 0,
                shoppingList: 0,
                mealPlan: 0,
                extras: 0,
              },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async () => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Delete' }))

    await expect(
      await body.findByText(
        'lovage is still in use, so you cannot delete it: 1 deleted recipe still in your meal plan. Remove it from those first.',
      ),
    ).toBeInTheDocument()
  },
}
