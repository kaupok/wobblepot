import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { SignInForm } from './SignInForm'

const NOTE = 'Sign up first and set up your household. Then start connecting again from the app.'

const meta = {
  title: 'Feature/Auth/SignInForm',
  component: SignInForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The `/sign-in` form. With Google configured (`googleEnabled`, HON-1157) it adds Continue with Google, which never creates an account; a failed attempt comes back with `?error=<code>`. When an MCP client is connecting (HON-1150), the page passes `isOAuthRequest` and the form adds a note under the sign-up link: sign-up does not carry the OAuth request through, so a new user sets up first and connects again (HON-1162).',
      },
    },
  },
} satisfies Meta<typeof SignInForm>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/sign-up')
    await expect(canvas.queryByText(NOTE)).not.toBeInTheDocument()
    // Google sign-in not configured (HON-1157).
    await expect(canvas.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
  },
}

export const OAuthRequest: Story = {
  args: { isOAuthRequest: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/sign-up')
    await expect(canvas.getByText(NOTE)).toBeVisible()
  },
}

/** Google sign-in configured (HON-1157): Continue with Google under an "or" rule. */
export const WithGoogle: Story = {
  args: { googleEnabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('or')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  },
}

/** A Google account with no Wobblepot account came back with `?error=signup_disabled`. */
export const GoogleNoAccount: Story = {
  args: { googleEnabled: true },
  parameters: {
    nextjs: { navigation: { pathname: '/sign-in', query: { error: 'signup_disabled' } } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent('No Wobblepot account uses this Google account yet.')
    await expect(within(alert).getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      '/sign-up',
    )
  },
}
