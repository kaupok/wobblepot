import { useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { AllergenPicker } from './AllergenPicker'

/** Controlled wrapper, so ticking a chip moves the value in the canvas. */
function Controlled(args: ComponentProps<typeof AllergenPicker>) {
  const [value, setValue] = useState(args.value)
  return (
    <AllergenPicker
      {...args}
      value={value}
      onChange={(next) => {
        setValue(next)
        args.onChange(next)
      }}
    />
  )
}

const meta = {
  title: 'Feature/Household/AllergenPicker',
  component: AllergenPicker,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The household’s allergens to avoid, with the AI notice that is the DPIA’s point-of-entry affirmation (HON-666). Onboarding step 3 and the household settings form both render it (HON-1082).',
      },
    },
  },
  args: {
    value: [],
    onChange: fn(),
  },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof AllergenPicker>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing ticked. Ticking a chip and unticking it reports each new list. */
export const NothingTicked: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('group', { name: /allergens to avoid/i })
    await expect(within(group).getAllByRole('button')).toHaveLength(9)
    await expect(canvas.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy',
    )

    const nuts = canvas.getByRole('button', { name: /tree nuts/i })
    await userEvent.click(nuts)
    await expect(args.onChange).toHaveBeenLastCalledWith(['nuts'])
    await expect(nuts).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(nuts)
    await expect(args.onChange).toHaveBeenLastCalledWith([])
  },
}

export const SomeTicked: Story = {
  args: { value: ['gluten', 'nuts', 'sesame'] },
}

/** While a save or a create request is pending. */
export const Disabled: Story = {
  args: { value: ['dairy'], disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const toggle of canvas.getAllByRole('button')) await expect(toggle).toBeDisabled()
  },
}

/** An error outside the picker joins the group's description. */
export const WithError: Story = {
  args: { errorId: 'allergen-story-error' },
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Controlled {...args} />
      <p id="allergen-story-error" role="alert">
        Could not save. Try again.
      </p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('group')).toHaveAccessibleDescription(/could not save/i)
  },
}
