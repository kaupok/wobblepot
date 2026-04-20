import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createUnmatchedIngredientRowData, ingredientResults } from '@/stories/fixtures'
import { emptyIngredientsHandlers, loadingIngredientsHandlers } from '@/stories/msw-handlers'
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
