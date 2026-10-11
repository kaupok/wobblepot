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
          'The `/sign-in` form. When an MCP client is connecting (HON-1150), the page passes `isOAuthRequest` and the form adds a note under the sign-up link: sign-up does not carry the OAuth request through, so a new user sets up first and connects again (HON-1162).',
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
