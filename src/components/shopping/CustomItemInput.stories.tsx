import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { defaultHandlers } from '@/stories/msw-handlers'

import { CustomItemInput } from './CustomItemInput'

const meta = {
  title: 'Feature/Shopping/CustomItemInput',
  component: CustomItemInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Text input for adding custom items to the shopping list. POSTs to `/api/shopping-list/custom` (MSW-backed in Storybook). Empty/whitespace input is a no-op. While the household types, a dropdown suggests its staples (`GET /api/pantry/staples`); picking one marks it ran out with `PATCH /api/pantry/:id`, and a typed staple name sent with Enter does the same on the server (HON-1400).',
      },
    },
  },
  args: {
    onItemAdded: fn(),
    onStapleRanOut: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CustomItemInput>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithText: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText('Add an item…')
    await userEvent.type(input, 'Olive oil')
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

// Play story — submit flow wires to MSW, which returns a custom-item record;
// component then calls `onItemAdded` and clears the input.
export const SubmitInvokesCallback: Story = {
  args: {
    onItemAdded: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText<HTMLInputElement>('Add an item…')
    await userEvent.type(input, '  Paper towels  ')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(args.onItemAdded).toHaveBeenCalled())
    const [arg] = (args.onItemAdded as ReturnType<typeof fn>).mock.calls[0] ?? []
    // Server echoes the trimmed name — MSW handler uses the request body.
    expect(arg).toMatchObject({ name: 'Paper towels' })
    await waitFor(() => expect(input.value).toBe(''))
  },
}

export const EmptySubmitIsNoOp: Story = {
  args: {
    onItemAdded: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText('Add an item…')
    await userEvent.click(input)
    await userEvent.keyboard('{Enter}')
    // No network call, no callback.
    await expect(args.onItemAdded).not.toHaveBeenCalled()
  },
}

export const ServerError: Story = {
  name: 'Error (server 500)',
  parameters: {
    msw: {
      // First: MSW answers with the first matching handler.
      handlers: [
        http.post('/api/shopping-list/custom', () =>
          HttpResponse.json({ error: 'Failed to add item' }, { status: 500 }),
        ),
        ...defaultHandlers,
      ],
    },
    docs: {
      description: {
        story:
          'Submit fires a request; server returns 500. Component surfaces a toast (out-of-canvas) and leaves the input populated.',
      },
    },
  },
}

// The default MSW staples are Milk and Olive oil.
export const SuggestsStaple: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox', { name: 'Add custom item to shopping list' })
    await userEvent.type(input, 'mil')

    const option = await canvas.findByRole('option', { name: /Milk/ })
    await expect(canvas.getByRole('listbox', { name: 'Staples' })).toBeVisible()
    await expect(canvas.queryByRole('option', { name: /Olive oil/ })).not.toBeInTheDocument()

    await userEvent.keyboard('{ArrowDown}')
    await expect(option).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(args.onStapleRanOut).toHaveBeenCalledWith('pantry-milk'))
    await expect(args.onItemAdded).not.toHaveBeenCalled()
    await expect(input).toHaveValue('')
  },
}

export const StapleTypedExactly: Story = {
  name: 'Staple typed exactly (Enter)',
  parameters: {
    msw: {
      // First: MSW answers with the first matching handler.
      handlers: [
        http.post('/api/shopping-list/custom', () =>
          HttpResponse.json({
            status: 'staple_ran_out',
            pantryItemId: 'pantry-milk',
            ingredientName: 'Milk',
          }),
        ),
        ...defaultHandlers,
      ],
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox', { name: 'Add custom item to shopping list' })
    await userEvent.type(input, 'Milk')
    await canvas.findByRole('listbox', { name: 'Staples' })
    // Enter with no option active sends the name; the server matches it.
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(args.onStapleRanOut).toHaveBeenCalledWith('pantry-milk'))
    await expect(args.onItemAdded).not.toHaveBeenCalled()
  },
}
