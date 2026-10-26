import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { HouseholdIngredientList } from './HouseholdIngredientList'
import { lovage, speltPasta } from './ingredient-fixtures'

const LIST_URL = '/api/households/me/ingredients'

const listHandler = (ingredients = [lovage, speltPasta]) =>
  http.get(LIST_URL, () => HttpResponse.json({ ingredients }))

const meta = {
  title: 'Feature/Household/HouseholdIngredientList',
  component: HouseholdIngredientList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    msw: { handlers: [listHandler()] },
    docs: {
      description: {
        component:
          'Household → Ingredients (HON-1264): the ingredients the household added from a recipe, each with its category, its allergens, Edit and Delete. Edit opens `EditIngredientDialog`; Delete opens `DeleteIngredientDialog`. Both open from state, so each hands focus back to the row button, or to the heading once the row is gone.',
      },
    },
  },
} satisfies Meta<typeof HouseholdIngredientList>

export default meta
type Story = StoryObj<typeof meta>

export const WithIngredients: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Carbs · Contains: Gluten, Eggs')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Edit lovage' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Delete lovage' })).toBeInTheDocument()
  },
}

export const Empty: Story = {
  parameters: { msw: { handlers: [listHandler([])] } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('Ingredients you add from a recipe show here.'),
    ).toBeInTheDocument()
  },
}

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(LIST_URL, async () => {
          await delay('infinite')
          return HttpResponse.json({ ingredients: [] })
        }),
      ],
    },
  },
}

export const Error: Story = {
  parameters: {
    msw: {
      handlers: [http.get(LIST_URL, () => HttpResponse.json({ error: 'boom' }, { status: 500 }))],
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(
        'Could not load your ingredients. Reload the page to try again.',
      ),
    ).toBeInTheDocument()
  },
}

/** Edit, tick an allergen, Save: the dialog closes and focus is back on Edit. */
export const EditAnAllergen: Story = {
  parameters: {
    msw: {
      handlers: [
        listHandler(),
        http.patch('/api/ingredients/:id', () => HttpResponse.json({ ingredient: lovage })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const edit = await canvas.findByRole('button', { name: 'Edit lovage' })

    await userEvent.click(edit)
    const dialog = await body.findByRole('dialog', { name: 'Edit ingredient: lovage' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gluten' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(edit).toHaveFocus())
  },
}

/** Delete a row a recipe uses: the dialog names the use and keeps the row. */
export const DeleteAUsedRow: Story = {
  parameters: {
    msw: {
      handlers: [
        listHandler(),
        http.delete('/api/ingredients/:id', () =>
          HttpResponse.json(
            {
              error: 'Ingredient in use',
              code: 'in_use',
              uses: { meals: 1, pantry: 0, shoppingList: 0, mealPlan: 0, extras: 0 },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(await canvas.findByRole('button', { name: 'Delete spelt pasta' }))
    await userEvent.click(await body.findByRole('button', { name: 'Delete' }))

    await expect(
      await body.findByText(
        'spelt pasta is still in use, so you cannot delete it: 1 recipe. Remove it from those first.',
      ),
    ).toBeInTheDocument()
  },
}
