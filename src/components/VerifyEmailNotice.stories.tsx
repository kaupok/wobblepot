import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { VerifyEmailNotice } from './VerifyEmailNotice'

// `authClient.sendVerificationEmail()` posts to the absolute
// `getClientBaseURL()` origin, not the Storybook origin, so the handler
// matches any origin.
const SEND = '*/api/auth/send-verification-email'

/** Called by the default handler with the request body, so a play function can assert it. */
const sendSpy = fn()

const RESEND = { name: 'Send a verification link' }

const meta = {
  title: 'Feature/Account/VerifyEmailNotice',
  component: VerifyEmailNotice,
  tags: ['autodocs'],
  args: {
    email: 'ann@example.com',
    emailVerified: false,
    landing: null,
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The account email\'s verification state (HON-1155): always on `/account` (My account → Profile), and on `/onboarding` after the link landed there. Unverified: a warning with "Send a verification link". After an expired or broken link the warning says so. Verified: nothing, except once after the link landed on `/account?verified=1`. Errors show catalog copy; focus returns to the button after a failure and moves to the "Sent" message after success.',
      },
    },
    msw: {
      handlers: [
        http.post(SEND, async ({ request }) => {
          sendSpy(await request.json())
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
} satisfies Meta<typeof VerifyEmailNotice>

export default meta
type Story = StoryObj<typeof meta>

export const NotVerified: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('is not verified yet')
    await expect(canvas.getByRole('button', RESEND)).toBeEnabled()
  },
}

export const Sent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    sendSpy.mockClear()
    await userEvent.click(canvas.getByRole('button', RESEND))
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent('Sent. Check your inbox.'),
    )
    await expect(sendSpy).toHaveBeenCalledWith({
      email: 'ann@example.com',
      callbackURL: '/account?verified=1',
    })
    await expect(canvas.queryByRole('button', RESEND)).not.toBeInTheDocument()
  },
}

export const Sending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(SEND, async () => {
          await delay('infinite')
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', RESEND))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Sending…' })).toBeDisabled())
  },
}

export const ExpiredLink: Story = {
  args: { landing: 'expired' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'This verification link has expired. Send a new one.',
    )
    await expect(canvas.getByRole('button', RESEND)).toBeInTheDocument()
  },
}

export const InvalidLink: Story = {
  args: { landing: 'invalid' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'This verification link does not work. Send a new one.',
    )
  },
}

export const JustVerified: Story = {
  args: { emailVerified: true, landing: 'verified' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Your email address is verified.')
    await expect(canvas.queryByRole('button', RESEND)).not.toBeInTheDocument()
  },
}

/** A verified account with no landing renders nothing. */
export const Verified: Story = {
  args: { emailVerified: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('status')).not.toBeInTheDocument()
  },
}

export const RateLimited: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(SEND, () => HttpResponse.json({ error: 'Too many requests' }, { status: 429 })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', RESEND))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'Too many attempts. Please try again in a few minutes.',
      ),
    )
    await waitFor(() => expect(canvas.getByRole('button', RESEND)).toHaveFocus())
  },
}

export const SendFailed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(SEND, () =>
          HttpResponse.json({ message: 'Internal Server Error' }, { status: 500 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', RESEND))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent('The email was not sent. Try again.'),
    )
  },
}
