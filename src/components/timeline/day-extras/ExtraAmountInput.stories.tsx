import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'

import { ExtraAmountInput } from './ExtraAmountInput'

const meta = {
  title: 'Feature/Timeline/ExtraAmountInput',
  component: ExtraAmountInput,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { value: null, onValueChange: fn() },
} satisfies Meta<typeof ExtraAmountInput>

export default meta
type Story = StoryObj<typeof meta>

/** An ingredient weighed in grams. */
export const Grams: Story = {
  args: { ingredient: { defaultUnit: 'g' }, value: 200 },
}

/** An ingredient measured by volume: grams stored, millilitres shown. */
export const Millilitres: Story = {
  args: { ingredient: { defaultUnit: 'g', measuredByVolume: true }, value: 750 },
}

/** An ingredient counted in pieces. */
export const Pieces: Story = {
  args: { ingredient: { unit: 'piece' }, value: 6 },
}

/** No amount yet: the field is optional. */
export const NoAmount: Story = {
  args: { ingredient: { defaultUnit: 'g' } },
}
