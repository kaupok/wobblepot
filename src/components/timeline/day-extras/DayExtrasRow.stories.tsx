import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'

import { chipsExtra, mixedExtras, wineExtra } from '@/stories/day-extra-fixtures'

import { DayExtrasRow } from './DayExtrasRow'

const meta = {
  title: 'Feature/Timeline/DayExtrasRow',
  component: DayExtrasRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { extras: mixedExtras, onRemoved: fn() },
} satisfies Meta<typeof DayExtrasRow>

export default meta
type Story = StoryObj<typeof meta>

/** A day with no extras renders nothing. */
export const Empty: Story = {
  args: { extras: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('list')).not.toBeInTheDocument()
  },
}

/** An amount, free text, and an ingredient with no amount. */
export const Mixed: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Extras' })
    await expect(within(list).getAllByRole('button')).toHaveLength(3)
  },
}

/** The edit dialog of an ingredient extra: its amount, and Remove. */
export const EditIngredient: Story = {
  args: { extras: [wineExtra], defaultOpenId: wineExtra.id },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole('dialog', { name: 'Red wine' }))
    await expect(dialog.getByLabelText('Amount (optional)')).toHaveValue('750')
    await expect(dialog.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  },
}

/** The edit dialog of a free-text extra: Remove only. */
export const EditFreeText: Story = {
  args: { extras: [chipsExtra], defaultOpenId: chipsExtra.id },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole('dialog', { name: 'chips' }))
    await expect(dialog.queryByLabelText('Amount (optional)')).not.toBeInTheDocument()
  },
}
