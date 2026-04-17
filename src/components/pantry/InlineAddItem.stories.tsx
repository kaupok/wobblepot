import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  conflictPantryHandlers,
  defaultHandlers,
  emptyIngredientsHandlers,
  errorPantryHandlers,
  loadingIngredientsHandlers,
} from '@/stories/msw-handlers'
import { InlineAddItem } from './InlineAddItem'

const meta = {
  title: 'Feature/Pantry/InlineAddItem',
  component: InlineAddItem,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Search-and-add combobox for the pantry. Debounces input by 300 ms, queries `/api/ingredients?search=…`, and POSTs to `/api/pantry` when the user picks a row. Fires `onItemAdded` with the server response on success.',
      },
    },
  },
  args: {
    onItemAdded: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InlineAddItem>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Default — input is empty, no dropdown shown.',
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
          'Search never resolves — the loading spinner stays visible inside the input so the affordance is reviewable.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.type(input, 'chicken')
  },
}

export const WithResults: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Default MSW handler matches the catalog by substring — typing "chick" surfaces Chicken thigh in the dropdown.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.type(input, 'chick')
    await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
  },
}

export const NoResults: Story = {
  parameters: {
    msw: { handlers: emptyIngredientsHandlers },
    docs: {
      description: {
        story:
          'Search returns no matches — the dropdown shows the "No ingredients found" empty-state copy.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.type(input, 'xyzzy')
    await canvas.findByText(/no ingredients found/i, undefined, { timeout: 3000 })
  },
}

export const AlreadyInPantry: Story = {
  args: {
    pantryIngredientIds: new Set(['chicken-thigh']),
  },
  parameters: {
    docs: {
      description: {
        story:
          'When the caller supplies `pantryIngredientIds`, matching rows render with an "In pantry" badge so the user can see duplicates before clicking.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.type(input, 'chick')
    await canvas.findByText(/in pantry/i, undefined, { timeout: 3000 })
  },
}

// Play story — type → wait for dropdown → click → onItemAdded fires and the
// input clears. Default MSW `/api/pantry` handler echoes the ingredient back.
export const SubmitInvokesCallback: Story = {
  args: {
    onItemAdded: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText<HTMLInputElement>(/add ingredient to pantry/i)
    await userEvent.type(input, 'chick')

    const option = await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.click(option)

    await waitFor(() =>
      expect(args.onItemAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredient: expect.objectContaining({ id: 'chicken-thigh', name: 'Chicken thigh' }),
          isStaple: false,
        }),
      ),
    )
    await waitFor(() => expect(input.value).toBe(''))
  },
}

// Pressing Enter with no query in flight is a no-op — no fetch, no callback.
export const EmptySubmitIsNoOp: Story = {
  args: {
    onItemAdded: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.click(input)
    await userEvent.keyboard('{Enter}')
    await expect(args.onItemAdded).not.toHaveBeenCalled()
  },
}

// Selecting via ArrowDown + Enter (keyboard path) invokes the callback exactly
// like the click path above.
export const KeyboardSelectionInvokesCallback: Story = {
  args: {
    onItemAdded: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.type(input, 'chick')

    await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.keyboard('{ArrowDown}{Enter}')

    await waitFor(() =>
      expect(args.onItemAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredient: expect.objectContaining({ id: 'chicken-thigh' }),
        }),
      ),
    )
  },
}

export const ConflictDoesNotFireCallback: Story = {
  name: 'Server conflict (409)',
  args: {
    onItemAdded: fn(),
  },
  parameters: {
    // Keep the default `/api/ingredients` handler so the dropdown populates,
    // then override `POST /api/pantry` with a 409 conflict.
    msw: { handlers: [...conflictPantryHandlers, ...defaultHandlers] },
    docs: {
      description: {
        story:
          'POST returns 409 — component surfaces an "already in your pantry" toast (out-of-canvas) and does not fire `onItemAdded`.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText(/add ingredient to pantry/i)
    await userEvent.type(input, 'chick')
    const option = await canvas.findByRole('button', { name: /chicken thigh/i }, { timeout: 3000 })
    await userEvent.click(option)
    // Let the request resolve; no callback should fire.
    await waitFor(() => expect(args.onItemAdded).not.toHaveBeenCalled())
  },
}

export const ServerError: Story = {
  name: 'Server error (500)',
  parameters: {
    // Spread defaults so the ingredient search still resolves; the pantry
    // POST falls through to the 500 override.
    msw: { handlers: [...errorPantryHandlers, ...defaultHandlers] },
    docs: {
      description: {
        story:
          'POST returns 500 — component surfaces an error toast (out-of-canvas) and leaves the input populated.',
      },
    },
  },
}
