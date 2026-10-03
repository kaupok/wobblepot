import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  pressEscape,
} from '@/stories/a11y-helpers'
import {
  errorAddMemberHandlers,
  householdFullAddMemberHandlers,
  submittingAddMemberHandlers,
} from '@/stories/msw-handlers'
import { AddMemberDialog } from './AddMemberDialog'

const meta = {
  title: 'Feature/Household/AddMemberDialog',
  component: AddMemberDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Dialog for adding a manual household member (typically a child): one Name field and the shared `PortionSizeField`. Trigger lives inline; click "Add member" to open. Submission posts to `/api/households/me/members` via MSW in stories.',
      },
    },
  },
  args: {
    onMemberAdded: fn(),
  },
} satisfies Meta<typeof AddMemberDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Default state — dialog trigger only. Click "Add member" to open.',
      },
    },
  },
}

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    await body.findByRole('dialog')
  },
}

export const Submitting: Story = {
  parameters: {
    msw: { handlers: submittingAddMemberHandlers },
    docs: {
      description: {
        story:
          'POST never resolves — submit button stays in its "Adding..." pending state so the disabled UI is visible.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    await body.findByRole('dialog')
    const nameInput = await body.findByLabelText('Name')
    await userEvent.type(nameInput, 'Kiddo')
    const submitButton = await body.findByRole('button', { name: /^add member$/i })
    await userEvent.click(submitButton)
    await body.findByRole('button', { name: /adding/i })
  },
}

export const Error: Story = {
  parameters: {
    msw: { handlers: errorAddMemberHandlers },
    docs: {
      description: {
        story:
          'POST returns 400 with an English server message. The dialog renders the translated fallback inline, never the server text.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    const nameInput = await body.findByLabelText('Name')
    await userEvent.type(nameInput, 'Kiddo')
    const submitButton = await body.findByRole('button', { name: /^add member$/i })
    await userEvent.click(submitButton)
    await body.findByText('Failed to add member')
    await expect(body.queryByText(/a member with that name already exists/i)).toBeNull()
  },
}

export const HouseholdFull: Story = {
  parameters: {
    msw: { handlers: householdFullAddMemberHandlers },
    docs: {
      description: {
        story:
          'POST returns the `household_full` cap rejection (HON-720). The dialog explains the limit instead of the generic failure copy.',
      },
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    const nameInput = await body.findByLabelText('Name')
    await userEvent.type(nameInput, 'Kiddo')
    const submitButton = await body.findByRole('button', { name: /^add member$/i })
    await userEvent.click(submitButton)
    await body.findByText(/already has 30 members/i)
    await expect(body.queryByText('Failed to add member')).toBeNull()
    await expect(args.onMemberAdded).not.toHaveBeenCalled()
  },
}

// Play stories — exercise the parent-callback contract under @storybook/addon-vitest.
// The default MSW handler in `msw-handlers.ts` echoes the submitted name back as a
// new member, so onMemberAdded fires with the server's response shape.

export const SubmitInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    await body.findByRole('dialog')

    // A member without an account has one name field (HON-1021).
    await expect(body.queryByLabelText(/display name/i)).toBeNull()
    const nameInput = await body.findByLabelText('Name')
    await expect(nameInput).toHaveAttribute('placeholder', 'e.g., Mia')
    await userEvent.type(nameInput, 'Kiddo')

    const smallPortion = await body.findByRole('radio', { name: /small \(0\.75×\)/i })
    await userEvent.click(smallPortion)
    await expect(smallPortion).toHaveAttribute('aria-checked', 'true')

    const submitButton = await body.findByRole('button', { name: /^add member$/i })
    await userEvent.click(submitButton)

    await waitFor(() =>
      expect(args.onMemberAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Kiddo',
          preferences: expect.objectContaining({
            displayName: null,
            portionMultiplier: 0.75,
          }),
        }),
      ),
    )
  },
}

// Custom portion: the input shows only after Custom is picked, and the typed
// value is what gets posted.
export const SubmitCustomPortion: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    await body.findByRole('dialog')

    await userEvent.type(await body.findByLabelText('Name'), 'Kiddo')
    await expect(body.queryByRole('textbox', { name: /portion multiplier/i })).toBeNull()
    await userEvent.click(body.getByRole('radio', { name: /custom/i }))
    const portionInput = body.getByRole('textbox', { name: /portion multiplier/i })
    await userEvent.clear(portionInput)
    await userEvent.type(portionInput, '1.25')

    await userEvent.click(body.getByRole('button', { name: /^add member$/i }))
    await waitFor(() =>
      expect(args.onMemberAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({ portionMultiplier: 1.25 }),
        }),
      ),
    )
  },
}

// An out-of-range custom value blocks the submit with the range message.
export const InvalidCustomPortion: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    await body.findByRole('dialog')

    await userEvent.type(await body.findByLabelText('Name'), 'Kiddo')
    await userEvent.click(body.getByRole('radio', { name: /custom/i }))
    const portionInput = body.getByRole('textbox', { name: /portion multiplier/i })
    await userEvent.clear(portionInput)
    await userEvent.type(portionInput, '4')
    await userEvent.click(body.getByRole('button', { name: /^add member$/i }))

    await body.findByText('Portion size must be between 0.5 and 3.0')
    await expect(args.onMemberAdded).not.toHaveBeenCalled()
  },
}

export const A11yInteractionPatterns: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: /add member/i })

    await userEvent.click(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    await pressEscape()
    await awaitDialogClosed()
  },
}
