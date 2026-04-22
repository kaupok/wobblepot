import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { QuantityControls } from './QuantityControls'

// Drive a controlled React input the way React expects: use the native value
// setter to bypass React's value-tracking, then dispatch a bubbling input
// event so React's SyntheticEvent layer picks it up and fires onChange. This
// sidesteps the caret/re-render collision that `userEvent.type` runs into on
// a fully-controlled number input, and the "change event not bubbling through
// React" problem that plain `fireEvent.change` has on React 19.
function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const meta = {
  title: 'Feature/Recipes/QuantityControls',
  component: QuantityControls,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    totalQuantity: 600,
    unitLabel: 'g',
    isVague: false,
    isInvalidQuantity: false,
    disabled: false,
    onQuantityChange: fn(),
    onSetQuantity: fn(),
    onMarkAsVague: fn(),
  },
} satisfies Meta<typeof QuantityControls>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Piece: Story = {
  args: {
    totalQuantity: 2,
    unitLabel: '',
  },
  parameters: {
    docs: {
      description: {
        story: 'Piece-unit ingredients render without a unit suffix.',
      },
    },
  },
}

export const Vague: Story = {
  args: {
    isVague: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Vague quantity replaces the numeric input with a "Set quantity" button.',
      },
    },
  },
}

export const InvalidZero: Story = {
  args: {
    totalQuantity: 0,
    isInvalidQuantity: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Zero quantity triggers the destructive border on the input wrapper.',
      },
    },
  },
}

export const InvalidNegative: Story = {
  args: {
    totalQuantity: -10,
    isInvalidQuantity: true,
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
  },
}

// Play stories — verify the three parent-callback contracts under
// @storybook/addon-vitest.

export const ChangingQuantityInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /quantity/i }) as HTMLInputElement
    setInputValue(input, '250')
    await expect(args.onQuantityChange).toHaveBeenLastCalledWith(250)
  },
}

export const CommaDecimalInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /quantity/i }) as HTMLInputElement
    setInputValue(input, '1,5')
    // Estonian comma-decimal parses identically to the English dot-decimal.
    await expect(args.onQuantityChange).toHaveBeenLastCalledWith(1.5)
  },
}

export const MarkAsVagueInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /no quantity/i })
    await userEvent.click(button)
    await expect(args.onMarkAsVague).toHaveBeenCalledTimes(1)
  },
}

export const SetQuantityInvokesCallback: Story = {
  args: {
    isVague: true,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: /set quantity/i })
    await userEvent.click(button)
    await expect(args.onSetQuantity).toHaveBeenCalledTimes(1)
  },
}
