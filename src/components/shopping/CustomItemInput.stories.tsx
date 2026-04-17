import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
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
          'Text input for adding custom items to the shopping list. POSTs to `/api/shopping-list/custom` (MSW-backed in Storybook). Empty/whitespace input is a no-op.',
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
} satisfies Meta<typeof CustomItemInput>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithText: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText('Add an item...')
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
    const input = canvas.getByPlaceholderText<HTMLInputElement>('Add an item...')
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
    const input = canvas.getByPlaceholderText('Add an item...')
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
      handlers: [
        ...defaultHandlers,
        http.post('/api/shopping-list/custom', () =>
          HttpResponse.json({ error: 'Failed to add item' }, { status: 500 }),
        ),
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
