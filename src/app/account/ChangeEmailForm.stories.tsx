import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ChangeEmailForm } from './ChangeEmailForm'

// `authClient.changeEmail()` posts to the absolute `getClientBaseURL()`
// origin, not the Storybook origin, so the handler matches any origin.
const CHANGE = '*/api/auth/change-email'

/** Called by the default handler with the request body, so a play function can assert it. */
const changeSpy = fn()

const SUBMIT = { name: 'Change email' }

async function typeAddress(canvasElement: HTMLElement, address: string) {
  const canvas = within(canvasElement)
  const field = canvas.getByLabelText('Email')
  await userEvent.clear(field)
  if (address) await userEvent.type(field, address)
  await userEvent.click(canvas.getByRole('button', SUBMIT))
  return canvas
}

const meta = {
  title: 'Feature/Account/ChangeEmailForm',
  component: ChangeEmailForm,
  tags: ['autodocs'],
  args: {
    email: 'ann@example.com',
    landing: null,
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The account email on My account → Profile, `/account`, with a change (HON-1137). Shown only to an account with a password. "Change email" sends a link to the new address and changes nothing yet; an address another account uses gets the same answer. The link lands back on `/account?emailChanged=1` (or `&error=…`), which shows the result once. Errors show catalog copy, and focus returns to the button.',
      },
    },
    msw: {
      handlers: [
        http.post(CHANGE, async ({ request }) => {
          changeSpy(await request.json())
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
} satisfies Meta<typeof ChangeEmailForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Email')).toHaveValue('ann@example.com')
    await expect(canvas.getByRole('button', SUBMIT)).toBeEnabled()
  },
}

export const Sent: Story = {
  play: async ({ canvasElement }) => {
    changeSpy.mockClear()
    const canvas = await typeAddress(canvasElement, 'ann.new@example.com')
    await waitFor(() =>
      expect(canvas.getByRole('status')).toHaveTextContent(
        'Check ann.new@example.com for a link. Your email changes when you open it.',
      ),
    )
    await expect(changeSpy).toHaveBeenCalledWith({
      newEmail: 'ann.new@example.com',
      callbackURL: '/account?emailChanged=1',
    })
    await expect(canvas.getByLabelText('Email')).toHaveValue('ann@example.com')
    await waitFor(() => expect(canvas.getByRole('button', SUBMIT)).toHaveFocus())
  },
}

export const SameAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await typeAddress(canvasElement, 'ann@example.com')
    await expect(canvas.getByRole('alert')).toHaveTextContent('This is your current email address.')
    await expect(canvas.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  },
}

export const Pending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(CHANGE, async () => {
          await delay('infinite')
          return HttpResponse.json({ status: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await typeAddress(canvasElement, 'ann.new@example.com')
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Sending…' })).toBeDisabled())
    await expect(canvas.getByLabelText('Email')).toBeDisabled()
  },
}

export const RateLimited: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(CHANGE, () => HttpResponse.json({ error: 'Too many requests' }, { status: 429 })),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await typeAddress(canvasElement, 'ann.new@example.com')
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent(
        'Too many attempts. Please try again in a few minutes.',
      ),
    )
    await waitFor(() => expect(canvas.getByRole('button', SUBMIT)).toHaveFocus())
  },
}

export const LandingChanged: Story = {
  args: { email: 'ann.new@example.com', landing: 'changed' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Your email address is now ann.new@example.com.',
    )
  },
}

export const LandingExpired: Story = {
  args: { landing: 'expired' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'This link has expired or was already used.',
    )
  },
}

export const LandingInvalid: Story = {
  args: { landing: 'invalid' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'This link does not work.',
    )
  },
}
