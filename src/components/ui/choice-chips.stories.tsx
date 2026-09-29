import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { ChoiceChips } from './choice-chips'

const MEMBER_TYPES = [
  { value: 'adult', label: 'Adult' },
  { value: 'child', label: 'Child' },
]

const PORTIONS = [
  { value: '0.75', label: 'Small (0.75x)' },
  { value: '1', label: 'Regular (1x)' },
  { value: '1.5', label: 'Large (1.5x)' },
  { value: '2', label: 'Extra large (2x)' },
]

/** Controlled wrapper, so clicks and arrow keys move the selection in the canvas. */
function Controlled(args: ComponentProps<typeof ChoiceChips>) {
  const [value, setValue] = useState(args.value)
  return (
    <ChoiceChips
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
  title: 'UI/ChoiceChips',
  component: ChoiceChips,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['default', 'sm'] },
    disabled: { control: 'boolean' },
  },
  args: {
    'aria-label': 'Member type',
    value: 'adult',
    options: MEMBER_TYPES,
    onValueChange: fn(),
  },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof ChoiceChips>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Arrow keys move the selection, and the group is one tab stop: Tab from the
 * checked chip leaves the group.
 */
export const Default: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-4">
      <Controlled {...args} />
      <button type="button">After the group</button>
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const group = within(canvas.getByRole('radiogroup', { name: 'Member type' }))
    const adult = group.getByRole('radio', { name: 'Adult' })
    const child = group.getByRole('radio', { name: 'Child' })
    const checked = () =>
      group.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')

    await expect(checked()).toEqual([adult])

    // Radix moves focus a tick after keydown and checks the newly focused radio
    // only while an arrow key is still down, so hold the key the way a real
    // press does: `{ArrowRight}` alone releases it before the focus move lands.
    await userEvent.click(adult)
    await userEvent.keyboard('{ArrowRight>}')
    await waitFor(() => expect(child).toHaveFocus())
    await userEvent.keyboard('{/ArrowRight}')
    await expect(checked()).toEqual([child])
    await expect(args.onValueChange).toHaveBeenLastCalledWith('child')

    await userEvent.keyboard('{ArrowLeft>}')
    await waitFor(() => expect(adult).toHaveFocus())
    await userEvent.keyboard('{/ArrowLeft}')
    await expect(checked()).toEqual([adult])
    await expect(args.onValueChange).toHaveBeenLastCalledWith('adult')

    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'After the group' })).toHaveFocus()
  },
}

export const Small: Story = {
  args: { size: 'sm', 'aria-label': 'Portion size', value: '1', options: PORTIONS },
}

export const Disabled: Story = {
  args: { disabled: true },
}

/** No option matches the value — e.g. a custom portion typed beside the presets. */
export const NoSelection: Story = {
  args: { size: 'sm', 'aria-label': 'Portion size', value: undefined, options: PORTIONS },
  play: async ({ canvasElement }) => {
    const radios = within(canvasElement).getAllByRole('radio')
    for (const radio of radios) await expect(radio).toHaveAttribute('aria-checked', 'false')
  },
}

/** The selected chip grows by its check icon; the row wraps inside a narrow column. */
export const LongLabel: Story = {
  args: {
    'aria-label': 'Start from',
    value: 'b',
    options: [
      { value: 'a', label: 'Today' },
      { value: 'b', label: 'Wednesday, 30 September' },
      { value: 'c', label: 'Thursday, 1 October' },
    ],
  },
  render: (args) => (
    <div className="w-64">
      <Controlled {...args} />
    </div>
  ),
}

export const AllVariants: Story = {
  render: ({ value, options, onValueChange }) => {
    const shared = { value, options, onValueChange }
    return (
      <div className="flex flex-col items-start gap-6">
        <Controlled {...shared} aria-label="Default size" />
        <Controlled {...shared} aria-label="Small size" size="sm" />
        <Controlled {...shared} aria-label="Disabled" disabled />
        <Controlled {...shared} aria-label="Nothing selected" value={undefined} />
      </div>
    )
  },
}
