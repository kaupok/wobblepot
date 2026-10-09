import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ChangePasswordForm } from './ChangePasswordForm'

// `authClient.changePassword()` posts to `/api/auth/change-password` on the
// absolute `getClientBaseURL()` origin, not the Storybook origin, so the
// handler matches any origin.
const CHANGE_PASSWORD = '*/api/auth/change-password'

async function fillIn(
  canvas: ReturnType<typeof within>,
  { confirm = 'brand-new-password-5678' } = {},
) {
  await userEvent.type(canvas.getByLabelText('Current password'), 'old-password-1234')
  await userEvent.type(canvas.getByLabelText('New password'), 'brand-new-password-5678')
  await userEvent.type(canvas.getByLabelText('Confirm new password'), confirm)
}

const meta = {
  title: 'Feature/Profile/ChangePasswordForm',
  component: ChangePasswordForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Changes the password on `/profile` (HON-1129) and signs out every other device (`revokeOtherSessions`). The form checks, before any request, that the current password is filled, the two new passwords match, and the new one has at least 12 characters. Server errors (a wrong current password, a breached new password) render catalog copy, and focus returns to the submit button.',
      },
    },
    msw: {
      handlers: [
        http.post(CHANGE_PASSWORD, () => HttpResponse.json({ token: 'new-session', user: {} })),
      ],
    },
  },
} satisfies Meta<typeof ChangePasswordForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('New password')).toHaveAccessibleDescription(
      'Use at least 12 characters. Avoid passwords from past data breaches.',
    )
    await expect(canvas.getByRole('button', { name: 'Change password' })).toBeEnabled()
  },
}

export const Mismatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fillIn(canvas, { confirm: 'something-else-1234' })
    await userEvent.click(canvas.getByRole('button', { name: 'Change password' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent('Passwords do not match')
  },
}

export const Pending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(CHANGE_PASSWORD, async () => {
          await delay('infinite')
          return HttpResponse.json({ token: 'new-session', user: {} })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fillIn(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Change password' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Changing password…' })).toBeDisabled(),
    )
    await expect(canvas.getByLabelText('Current password')).toBeDisabled()
  },
}

export const WrongCurrentPassword: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(CHANGE_PASSWORD, () =>
          HttpResponse.json(
            { code: 'INVALID_PASSWORD', message: 'Invalid password' },
            { status: 400 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fillIn(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Change password' }))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'The password you entered is incorrect. Please try again.',
      ),
    )
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Change password' })).toHaveFocus(),
    )
  },
}
