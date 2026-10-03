import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { PortionSizeField } from './PortionSizeField'

/** Controlled wrapper, so picking a chip or typing moves the value in the canvas. */
function Controlled(args: ComponentProps<typeof PortionSizeField>) {
  const [value, setValue] = useState(args.value)
  return (
    <PortionSizeField
      {...args}
      value={value}
      onValueChange={(next) => {
        setValue(next)
        args.onValueChange(next)
      }}
    />
  )
}

const meta = {
  title: 'Feature/Household/PortionSizeField',
  component: PortionSizeField,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The member dialogs’ portion picker (HON-1021): four preset chips and Custom. The number input shows only while Custom is chosen. The caller owns the range check and passes `error`.',
      },
    },
  },
  args: {
    labelId: 'portion-label',
    value: 1,
    onValueChange: fn(),
  },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof PortionSizeField>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A preset value checks its chip and hides the input. Picking Custom shows the
 * input with the current value; picking a preset hides it again.
 */
export const Preset: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: /regular \(1×\)/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(canvas.queryByRole('textbox', { name: /portion multiplier/i })).toBeNull()

    await userEvent.click(canvas.getByRole('radio', { name: /custom/i }))
    const input = canvas.getByRole('textbox', { name: /portion multiplier/i })
    await expect(input).toHaveValue('1')
    await expect(args.onValueChange).not.toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('radio', { name: /^large \(1\.5×\)/i }))
    await expect(canvas.queryByRole('textbox', { name: /portion multiplier/i })).toBeNull()
    await expect(args.onValueChange).toHaveBeenCalledWith(1.5)
  },
}

/** Custom stays chosen while the user types a value that equals a preset. */
export const CustomChosen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: /custom/i }))
    const input = canvas.getByRole('textbox', { name: /portion multiplier/i })
    await userEvent.clear(input)
    await userEvent.type(input, '2')
    await expect(canvas.getByRole('radio', { name: /custom/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(canvas.getByRole('textbox', { name: /portion multiplier/i })).toHaveValue('2')
  },
}

/** A value that matches no preset opens with Custom chosen and the input shown. */
export const NoPreset: Story = {
  args: { value: 1.25 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('radio', { name: /custom/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(canvas.getByRole('textbox', { name: /portion multiplier/i })).toHaveValue('1.25')
  },
}

/** Out of range: the input is marked invalid and points at the message. */
export const Invalid: Story = {
  args: { value: 4, error: 'Portion size must be between 0.5 and 3.0' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /portion multiplier/i })
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input).toHaveAccessibleDescription('Portion size must be between 0.5 and 3.0')
  },
}

export const Disabled: Story = {
  args: { value: 1.25, disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: /portion multiplier/i })).toBeDisabled()
    for (const radio of canvas.getAllByRole('radio')) {
      await expect(radio).toBeDisabled()
    }
  },
}
