import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { SignUpForm } from './SignUpForm'

const meta = {
  title: 'Feature/Auth/SignUpForm',
  component: SignUpForm,
  tags: ['autodocs'],
  args: {
    inviteRequired: false,
    inviteCodeLabel: 'Invite code',
    inviteCodeHint: 'Paste the code from your invitation.',
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The `/sign-up` form. The invite code (while `invite_code_required` is on, and no household invite) and the terms checkbox gate both ways to sign up. With Google configured (`googleEnabled`, HON-1157) Continue with Google sits under the email submit; it checks consent first, as the email path does, and sends no name, email or password.',
      },
    },
  },
} satisfies Meta<typeof SignUpForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Sign up' })).toBeEnabled()
    await expect(canvas.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
  },
}

export const InviteOnly: Story = {
  args: { inviteRequired: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Invite code')).toBeRequired()
  },
}

/** Google configured, invite-only: the code and consent sit above both buttons. */
export const WithGoogle: Story = {
  args: { inviteRequired: true, googleEnabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('or')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  },
}

/** Continue with Google with the checkbox unticked: the consent error, focus on the checkbox. */
export const GoogleWithoutConsent: Story = {
  args: { googleEnabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Continue with Google' }))
    await expect(canvas.getByRole('alert')).toHaveTextContent(
      'To create an account, accept the terms of service and privacy policy.',
    )
    await expect(canvas.getByRole('checkbox', { name: /terms of service/i })).toHaveFocus()
  },
}

/** Google came back with `?error=email_not_verified`. */
export const GoogleEmailNotVerified: Story = {
  args: { googleEnabled: true },
  parameters: {
    nextjs: { navigation: { pathname: '/sign-up', query: { error: 'email_not_verified' } } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'Google has not verified this email address.',
    )
  },
}
