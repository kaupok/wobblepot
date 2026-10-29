import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { SetPassword } from './SetPassword'

// `authClient.requestPasswordReset()` posts to the absolute
// `getClientBaseURL()` origin, not the Storybook origin, so the handler
// matches any origin.
const RESET = '*/api/auth/request-password-reset'

/** Called by the default handler with the request body, so a play function can assert it. */
const resetSpy = fn()

const SET = { name: 'Set a password' }

const meta = {
  title: 'Feature/Account/SetPassword',
  component: SetPassword,
  tags: ['autodocs'],
  args: { email: 'ann@example.com' },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The password section of My account → Profile for an account that signs in with Google only (HON-1158). It has no current password, so `ChangePasswordForm` cannot work; "Set a password" sends the reset email, and its link sets the password. The sent message replaces the button, so one click sends one email, and focus moves to the message. Errors show catalog copy and return focus to the button.',
      },
    },
    msw: {
      handlers: [
        http.post(RESET, async ({ request }) => {
          resetSpy(await request.json())
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
} satisfies Meta<typeof SetPassword>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', SET)).toBeEnabled()
  },
}

export const Sent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    resetSpy.mockClear()
    await userEvent.click(canvas.getByRole('button', SET))
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent(
        'Email sent. Open the link in it to set your password.',
      ),
    )
    await expect(resetSpy).toHaveBeenCalledTimes(1)
    await expect(resetSpy).toHaveBeenCalledWith({
      email: 'ann@example.com',
      redirectTo: '/reset-password',
    })
    await expect(canvas.queryByRole('button', SET)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(canvasElement.ownerDocument.activeElement).toHaveTextContent('Email sent'),
    )
  },
}

export const Sending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(RESET, async () => {
          await delay('infinite')
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', SET))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Sending…' })).toBeDisabled())
  },
}

export const RateLimited: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(RESET, () =>
          HttpResponse.json({ message: 'Too many requests' }, { status: 429 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', SET))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'Too many attempts. Please try again in a few minutes.',
      ),
    )
    await waitFor(() => expect(canvas.getByRole('button', SET)).toHaveFocus())
  },
}

export const Failed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(RESET, () =>
          HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', SET))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent('The email was not sent. Try again.'),
    )
  },
}
