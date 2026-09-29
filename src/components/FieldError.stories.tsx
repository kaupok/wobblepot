import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from './FieldError'

const meta = {
  title: 'Feature/FieldError',
  component: FieldError,
  tags: ['autodocs'],
  args: {
    children: 'Invalid email or password.',
  },
} satisfies Meta<typeof FieldError>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveTextContent('Invalid email or password.')
  },
}

export const UnderAnInput: Story = {
  render: (args) => (
    <div className="flex max-w-sm flex-col gap-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" aria-invalid aria-describedby="form-error" />
      <FieldError id="form-error" {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = canvas.getByRole('alert')
    await expect(canvas.getByLabelText('Email')).toHaveAccessibleDescription(
      'Invalid email or password.',
    )
    await expect(alert).toHaveAttribute('id', 'form-error')
  },
}

// The longest error a user meets: /reset-password without a token. At the
// 390px mobile viewport it wraps, which is what the `paragraph` level is for —
// the single-line `small` level set the two lines touching (HON-827).
export const WrappingMessage: Story = {
  args: {
    children: 'This reset link is incomplete. Request a new one and open the link from that email.',
  },
  render: (args) => (
    <div className="max-w-xs">
      <FieldError {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = canvas.getByRole('alert')
    // Two lines at a 24px line height. At the old 16px leading it measured 32px.
    await expect(alert.getBoundingClientRect().height).toBeGreaterThanOrEqual(48)
  },
}
