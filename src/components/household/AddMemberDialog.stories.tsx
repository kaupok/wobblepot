import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  pressEscape,
} from '@/stories/a11y-helpers'
import { errorAddMemberHandlers, submittingAddMemberHandlers } from '@/stories/msw-handlers'
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
          'Dialog for adding a manual household member (typically a child). Trigger lives inline; click "Add member" to open. Submission posts to `/api/households/me/members` via MSW in stories.',
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
        story: 'POST returns 400 with a server message — error renders inline in the form.',
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
    await body.findByText(/a member with that name already exists/i)
  },
}

// Play stories — exercise the parent-callback contract under @storybook/test-runner.
// The default MSW handler in `msw-handlers.ts` echoes the submitted name back as a
// new member, so onMemberAdded fires with the server's response shape.

export const SubmitInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /add member/i }))
    const body = within(document.body)
    await body.findByRole('dialog')

    const nameInput = await body.findByLabelText('Name')
    await userEvent.type(nameInput, 'Kiddo')

    const displayNameInput = await body.findByLabelText(/display name/i)
    await userEvent.type(displayNameInput, 'kid')

    const smallPortion = await body.findByRole('button', { name: /small \(0\.75x\)/i })
    await userEvent.click(smallPortion)

    const submitButton = await body.findByRole('button', { name: /^add member$/i })
    await userEvent.click(submitButton)

    await waitFor(() =>
      expect(args.onMemberAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Kiddo',
          preferences: expect.objectContaining({
            displayName: 'kid',
            portionMultiplier: 0.75,
          }),
        }),
      ),
    )
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
