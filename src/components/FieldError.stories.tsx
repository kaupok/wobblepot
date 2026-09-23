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
