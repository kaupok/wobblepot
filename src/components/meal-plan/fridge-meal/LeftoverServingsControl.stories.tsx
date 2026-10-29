import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { LeftoverServingsControl } from './LeftoverServingsControl'

const meta = {
  title: 'Meal plan/Fridge meal/LeftoverServingsControl',
  component: LeftoverServingsControl,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'The servings a leftover item takes from its meal (HON-1396): − and + in half steps, 0.5 to 20. A cooked source may stay unset; + then starts at the household’s own servings.',
      },
    },
  },
  args: {
    value: 2.5,
    onChange: fn(),
    defaultServings: 2.5,
    label: 'Servings: Chicken curry, from Wednesday',
  },
  render: (args) => {
    const [value, setValue] = useState(args.value)
    return (
      <LeftoverServingsControl
        {...args}
        value={value}
        onChange={(next) => {
          setValue(next)
          args.onChange(next)
        }}
      />
    )
  },
} satisfies Meta<typeof LeftoverServingsControl>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const group = within(
      within(canvasElement).getByRole('group', { name: 'Servings: Chicken curry, from Wednesday' }),
    )
    await userEvent.click(group.getByRole('button', { name: 'More servings' }))
    await expect(group.getByText('3 servings')).toBeInTheDocument()
    await expect(args.onChange).toHaveBeenCalledWith(3)
  },
}

/** At 0.5, − waits, aria-disabled so focus stays on it. */
export const AtMinimum: Story = {
  args: { value: 0.5 },
  play: async ({ canvasElement }) => {
    const fewer = within(canvasElement).getByRole('button', { name: 'Fewer servings' })
    await expect(fewer).toHaveAttribute('aria-disabled', 'true')
    await expect(within(canvasElement).getByText('0.5 servings')).toBeInTheDocument()
  },
}

/** A cooked source with no servings set. */
export const NotSet: Story = {
  args: { value: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Servings not set')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'More servings' }))
    await expect(canvas.getByText('2.5 servings')).toBeInTheDocument()
  },
}

export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('2,5 portsjonit')).toBeInTheDocument()
  },
}
