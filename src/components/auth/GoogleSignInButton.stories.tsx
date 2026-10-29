import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { AuthMethodDivider, GoogleSignInButton } from './GoogleSignInButton'

const meta = {
  title: 'Feature/Auth/GoogleSignInButton',
  component: GoogleSignInButton,
  tags: ['autodocs'],
  args: { onClick: fn() },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '"Continue with Google" on `/sign-in` and `/sign-up` (HON-1157), under an "or" rule (`AuthMethodDivider`). The forms own the Better Auth call; the button only shows it. Pending: the page is leaving for Google. Rendered only when the Google env vars are set.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="flex max-w-md flex-col gap-4">
        <AuthMethodDivider />
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GoogleSignInButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('or')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Continue with Google' }))
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Opening Google…' })).toBeDisabled()
  },
}

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Continue with Google' })).toBeDisabled()
  },
}
