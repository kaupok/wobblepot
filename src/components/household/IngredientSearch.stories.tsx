import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { emptyIngredientsHandlers, loadingIngredientsHandlers } from '@/stories/msw-handlers'
import { IngredientSearch } from './IngredientSearch'

const meta = {
  title: 'Feature/Household/IngredientSearch',
  component: IngredientSearch,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Combobox for adding ingredients to a meal. Debounces input by 300 ms and queries `/api/ingredients?search=…`. Highlight via arrow keys, select via Enter or click. Already-added ingredients render as disabled "Added" rows.',
      },
    },
  },
  args: {
    disabled: false,
    existingIngredientIds: [],
    onAddIngredient: fn(),
  },
} satisfies Meta<typeof IngredientSearch>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Default state — search field with no query and no dropdown.',
      },
    },
  },
}

export const Typing: Story = {
  parameters: {
    msw: { handlers: loadingIngredientsHandlers },
    docs: {
      description: {
        story:
          'Search response never resolves — spinner stays visible to verify the loading affordance.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox')
    await userEvent.type(input, 'chicken')
  },
}

export const WithResults: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Default MSW handler matches the catalog by substring — typing "chick" surfaces chicken thigh.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox')
    await userEvent.type(input, 'chick')
    await canvas.findByRole('listbox', undefined, { timeout: 3000 })
    await canvas.findByRole('option', { name: /chicken thigh/i })
  },
}

export const NoResults: Story = {
  parameters: {
    msw: { handlers: emptyIngredientsHandlers },
    docs: {
      description: {
        story: 'Search returns no matches — dropdown shows the "No ingredients found" copy.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox')
    await userEvent.type(input, 'xyzzy')
    await canvas.findByText(/no ingredients found/i, undefined, { timeout: 3000 })
  },
}

export const WithSelection: Story = {
  args: {
    existingIngredientIds: ['chicken-thigh'],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Already-added ingredient — when matching results include it, that row renders as disabled with an "Added" badge.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox')
    await userEvent.type(input, 'chick')
    const option = await canvas.findByRole('option', { name: /chicken thigh/i }, { timeout: 3000 })
    await expect(option).toBeDisabled()
  },
}

// Play story — exercises the parent-callback contract: type → wait for the
// dropdown → click an option → expect onAddIngredient with the ingredient.

export const SearchAndSelectInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox')
    await userEvent.type(input, 'chick')

    const option = await canvas.findByRole('option', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.click(option)

    await waitFor(() =>
      expect(args.onAddIngredient).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'chicken-thigh', name: 'Chicken thigh' }),
      ),
    )
  },
}
