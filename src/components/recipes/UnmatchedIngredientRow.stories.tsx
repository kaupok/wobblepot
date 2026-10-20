import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createUnmatchedIngredientRowData, ingredientResults } from '@/stories/fixtures'
import {
  emptyIngredientsHandlers,
  loadingIngredientsHandlers,
  synonymIngredientsHandlers,
} from '@/stories/msw-handlers'
import { expectWithinHorizontally } from '@/stories/layout-helpers'
import { UnmatchedIngredientRow } from './UnmatchedIngredientRow'

const meta = {
  title: 'Feature/Recipes/UnmatchedIngredientRow',
  component: UnmatchedIngredientRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Unmatched ingredient with debounced search. The default MSW handler serves matches from the `ingredientResults` catalog; per-story overrides force loading / empty states.',
      },
    },
  },
  args: {
    data: createUnmatchedIngredientRowData(),
    disabled: false,
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
} satisfies Meta<typeof UnmatchedIngredientRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Vague: Story = {
  args: {
    data: createUnmatchedIngredientRowData({
      isVague: true,
      originalPhrase: 'to taste',
    }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Vague quantity replaces the "Original: ..." line with the italicised extracted phrase.',
      },
    },
  },
}

export const VagueEstonian: Story = {
  name: 'Vague (Estonian)',
  globals: { locale: 'et' },
  args: {
    data: createUnmatchedIngredientRowData({ isVague: true, originalPhrase: 'to taste' }),
  },
  parameters: {
    docs: {
      description: {
        story:
          'The stored English phrase renders through `enums.VaguePhrase`, so an Estonian household reads "maitse järgi" (HON-917).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('maitse järgi')).toBeVisible()
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const Searching: Story = {
  parameters: {
    msw: { handlers: loadingIngredientsHandlers },
    docs: {
      description: {
        story: 'Search request hangs — the inline spinner stays visible next to the input.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/search ingredients/i)
    await userEvent.type(input, 'chicken')
    // Debounce + hung request => the loading spinner (icon) stays mounted.
    // No explicit assertion — the a11y / visual gate is the real check here.
  },
}

export const NoResults: Story = {
  parameters: {
    msw: { handlers: emptyIngredientsHandlers },
    docs: {
      description: {
        story: 'Search returns an empty array — the "No ingredients found" card renders.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/search ingredients/i)
    await userEvent.type(input, 'xyz')
    await canvas.findByText(/no ingredients found/i, undefined, { timeout: 3000 })
  },
}

// Play stories — verify `onResolve` and `onRemove` contracts under
// @storybook/addon-vitest. Uses default MSW handler for `/api/ingredients`.

export const TypingShowsResults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/search ingredients/i)
    await userEvent.type(input, 'chicken')
    // Debounced (300ms) → MSW → dropdown renders the chicken-thigh catalog entry.
    await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
  },
}

export const ClickingResultInvokesOnResolve: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/search ingredients/i)
    await userEvent.type(input, 'chicken')
    const result = await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.click(result)
    // handleSelectIngredient defaults `defaultQuantity` to 100 for gram-based units.
    await waitFor(() =>
      expect(args.onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ id: ingredientResults['chicken-thigh'].id }),
        100,
      ),
    )
  },
}

export const KeyboardNavigationInvokesOnResolve: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/search ingredients/i)
    await userEvent.type(input, 'chicken')
    // Wait for the debounce + MSW → dropdown appears.
    await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(args.onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ id: ingredientResults['chicken-thigh'].id }),
        100,
      ),
    )
  },
}

export const EscapeClosesDropdown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/search ingredients/i)
    await userEvent.type(input, 'chicken')
    await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: /chicken thigh/i })).not.toBeInTheDocument()
    })
  },
}

export const RemoveInvokesOnRemove: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const remove = canvas.getByRole('button', { name: /drop/i })
    await userEvent.click(remove)
    await expect(args.onRemove).toHaveBeenCalledTimes(1)
  },
}

export const MatchedByOtherName: Story = {
  parameters: {
    msw: { handlers: synonymIngredientsHandlers },
    docs: {
      description: {
        story:
          'A row found by another English name shows that name in brackets after the pool name, in the muted tone (HON-1100). Picking it passes the row without `matchedAs`, so the screens after the dropdown show the pool name only.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByPlaceholderText(/search ingredients/i), 'all-purpose')

    const result = await canvas.findByRole('button', { name: /plain flour/i }, { timeout: 3000 })
    await expect(result).toHaveTextContent('plain flour(all-purpose flour)')

    await userEvent.click(result)
    await waitFor(() =>
      expect(args.onResolve).toHaveBeenCalledWith(
        { id: 'plain-flour', name: 'plain flour', category: 'carb', defaultUnit: 'g' },
        100,
      ),
    )
  },
}

/** The answer the add form's Save gets: a new household row named as typed. */
const createdIngredientHandlers = [
  http.post('/api/ingredients', () =>
    HttpResponse.json(
      {
        ingredient: {
          id: 'household-pickled-daikon',
          name: 'pickled daikon',
          category: 'vegetable',
          defaultUnit: 'g',
          gramsPerPiece: null,
          measuredByVolume: false,
          calories: 25,
          protein: 0.5,
          carbs: 5,
          fat: 0.1,
        },
      },
      { status: 201 },
    ),
  ),
]

export const AddFormOpen: Story = {
  parameters: {
    msw: { handlers: createdIngredientHandlers },
    docs: {
      description: {
        story:
          '"Add as new ingredient" opens the form in place of the search (HON-1263). At the default 390px viewport every field stays inside the row, as the Imagine review dialog needs (HON-834). Saving resolves the row with the new ingredient and the parsed 50 g.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Add as new ingredient: pickled daikon' }),
    )

    const name = canvas.getByLabelText('Name')
    await expect(name).toHaveFocus()
    const row = canvasElement.querySelector<HTMLElement>('.border-warning\\/30')!
    for (const field of canvas.getAllByRole('textbox')) expectWithinHorizontally(field, row)
    for (const button of canvas.getAllByRole('button')) expectWithinHorizontally(button, row)

    await userEvent.click(canvas.getByRole('combobox', { name: 'Category' }))
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Vegetables' }))
    // Radix Select holds `pointer-events: none` on the body until it has closed.
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'))
    await userEvent.type(canvas.getByLabelText('Calories, kcal'), '25')
    await userEvent.type(canvas.getByLabelText('Protein, g'), '0,5')
    await userEvent.type(canvas.getByLabelText('Carbs, g'), '5')
    await userEvent.type(canvas.getByLabelText('Fat, g'), '0,1')
    await userEvent.click(canvas.getByRole('button', { name: 'Save ingredient' }))

    await waitFor(() =>
      expect(args.onResolve).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'household-pickled-daikon', name: 'pickled daikon' }),
        50,
      ),
    )
  },
}

export const AddButtonLongName: Story = {
  args: {
    data: createUnmatchedIngredientRowData({
      extractedName: 'Japanese sweet pickled daikon radish with yuzu peel',
    }),
  },
  decorators: [
    // The Imagine review dialog lays its body out on a grid, whose column grows
    // to its items' min-content width, then scrolls sideways.
    (Story) => (
      <div data-testid="dialog-column" className="grid overflow-x-auto">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'A long name truncates inside "Add as new ingredient" at 390px and does not widen the grid column around the row, as the Imagine review dialog has (HON-834); the row heading shows the name in full.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const column = canvas.getByTestId('dialog-column')
    const button = canvas.getByRole('button', { name: /^Add as new ingredient: Japanese/ })
    expectWithinHorizontally(button, column)
    await expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth)
  },
}
