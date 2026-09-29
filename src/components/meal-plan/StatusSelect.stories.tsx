import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { StatusSelect } from './StatusSelect'

const meta = {
  title: 'Meal plan/StatusSelect',
  component: StatusSelect,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    onChange: fn(),
  },
} satisfies Meta<typeof StatusSelect>

export default meta
type Story = StoryObj<typeof meta>

export const Planned: Story = {
  args: { value: 'planned' },
}

// Each status is a lucide icon hidden from the accessibility tree, so an
// option's name is the status label alone (HON-817).
export const OptionsShowIconsNotEmoji: Story = {
  args: { value: 'planned' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('combobox'))
    for (const name of ['Planned', 'Completed', 'Skipped']) {
      const option = await body.findByRole('option', { name })
      await expect(option).toHaveTextContent(new RegExp(`^${name}$`))
      await expect(option.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }

    await userEvent.click(body.getByRole('option', { name: 'Skipped' }))
    await expect(args.onChange).toHaveBeenCalledWith('skipped')
    // Let the closing listbox unmount, or axe audits it mid-exit without a name.
    await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull())
  },
}

export const Completed: Story = {
  args: { value: 'completed' },
}

export const Skipped: Story = {
  args: { value: 'skipped' },
}

export const Disabled: Story = {
  args: { value: 'planned', disabled: true },
}
