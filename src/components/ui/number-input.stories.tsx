import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fn, within } from 'storybook/test'
import { NumberInput } from './number-input'
import { Label } from './label'

// Controlled wrapper — React-Query-free state harness so stories can exercise
// the draft-preservation and external-sync contracts.
function Controlled({
  initial,
  integer,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof NumberInput>, 'value' | 'onValueChange'> & {
  initial?: number | null
  onValueChange?: (v: number | null) => void
}) {
  const [value, setValue] = useState<number | null>(initial ?? null)
  return (
    <NumberInput
      value={value}
      integer={integer}
      onValueChange={(v) => {
        setValue(v)
        onValueChange?.(v)
      }}
      {...props}
    />
  )
}

// Drive a controlled React input via the native value setter so React's
// onChange fires for `type="text"`. See `QuantityControls.stories.tsx` for
// the caret/re-render collision this works around.
function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const meta = {
  title: 'UI/NumberInput',
  component: NumberInput,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    integer: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  // Default args exist only to satisfy the NumberInput prop types at the
  // Story level — every render below uses `Controlled` so the actual
  // `value`/`onValueChange` pair is supplied internally.
  args: {
    value: null,
    onValueChange: () => {},
  },
} satisfies Meta<typeof NumberInput>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    'aria-label': 'quantity',
    placeholder: '0',
  },
  render: (args) => (
    <div className="w-48">
      <Controlled {...args} initial={1.5} />
    </div>
  ),
}

export const Integer: Story = {
  args: {
    'aria-label': 'servings',
    integer: true,
    placeholder: '4',
  },
  render: (args) => (
    <div className="w-48">
      <Controlled {...args} initial={4} />
    </div>
  ),
}

export const Empty: Story = {
  args: {
    'aria-label': 'quantity',
    placeholder: 'Enter a quantity',
  },
  render: (args) => (
    <div className="w-48">
      <Controlled {...args} initial={null} />
    </div>
  ),
}

export const Disabled: Story = {
  args: {
    'aria-label': 'quantity',
    disabled: true,
  },
  render: (args) => (
    <div className="w-48">
      <Controlled {...args} initial={250} />
    </div>
  ),
}

export const Invalid: Story = {
  args: {
    'aria-label': 'quantity',
    'aria-invalid': true,
  },
  render: (args) => (
    <div className="w-48">
      <Controlled {...args} initial={-1} />
    </div>
  ),
}

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-64 gap-2">
      <Label htmlFor="quantity-labelled">Quantity (g)</Label>
      <Controlled id="quantity-labelled" initial={500} placeholder="Enter quantity" />
    </div>
  ),
}

// WHY: Mirrors `input.stories.tsx` — disabled inputs dip below 4.5:1 contrast,
// which WCAG 1.4.3 exempts for inactive UI but axe can't infer.
export const AllVariants: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  render: () => (
    <div className="flex w-64 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-decimal">Decimal (default)</Label>
        <Controlled id="av-decimal" initial={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-integer">Integer</Label>
        <Controlled id="av-integer" integer initial={4} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-empty">Empty</Label>
        <Controlled id="av-empty" initial={null} placeholder="No value" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-disabled">Disabled</Label>
        <Controlled id="av-disabled" disabled initial={250} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="av-invalid">Invalid (aria-invalid)</Label>
        <Controlled id="av-invalid" aria-invalid initial={-1} />
      </div>
    </div>
  ),
}

// Play stories — the core contract is that both `.` and `,` produce the same
// numeric value via `onValueChange`, and the raw typed form is preserved in
// the draft so intermediate keystrokes don't jump.
export const DotDecimalInvokesCallback: Story = {
  args: {
    'aria-label': 'quantity',
    onValueChange: fn(),
  },
  render: (args) => (
    <div className="w-48">
      <NumberInput {...args} value={null} />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /quantity/i }) as HTMLInputElement
    setInputValue(input, '1.5')
    await expect(args.onValueChange).toHaveBeenLastCalledWith(1.5)
  },
}

export const CommaDecimalInvokesCallback: Story = {
  args: {
    'aria-label': 'quantity',
    onValueChange: fn(),
  },
  render: (args) => (
    <div className="w-48">
      <NumberInput {...args} value={null} />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /quantity/i }) as HTMLInputElement
    setInputValue(input, '1,5')
    // Estonian comma-decimal parses identically to the English dot-decimal.
    await expect(args.onValueChange).toHaveBeenLastCalledWith(1.5)
    // Draft preserves the user's comma-style input.
    await expect(input.value).toBe('1,5')
  },
}

export const GarbageInputReportsNull: Story = {
  args: {
    'aria-label': 'quantity',
    onValueChange: fn(),
  },
  render: (args) => (
    <div className="w-48">
      <NumberInput {...args} value={null} />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: /quantity/i }) as HTMLInputElement
    setInputValue(input, '1,5x')
    await expect(args.onValueChange).toHaveBeenLastCalledWith(null)
    // Draft stays so the user can correct the typo without retyping.
    await expect(input.value).toBe('1,5x')
  },
}
