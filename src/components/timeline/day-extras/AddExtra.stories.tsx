import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { defaultHandlers, extraSearchHandlers } from '@/stories/msw-handlers'
import { AddExtra } from './AddExtra'

// The picker searches the extras scenario's catalogue (red wine, white wine,
// eggs, olives); the rest of the API is the default handlers.
const handlers = [...extraSearchHandlers, ...defaultHandlers]

const meta = {
  title: 'Feature/Timeline/AddExtra',
  component: AddExtra,
  tags: ['autodocs'],
  parameters: { layout: 'padded', msw: { handlers } },
  args: {
    date: '2026-04-18',
    dayLabel: 'Saturday Apr 18',
  },
} satisfies Meta<typeof AddExtra>

export default meta
type Story = StoryObj<typeof meta>

/** The "+ Extra" button as it sits on a day heading. */
export const Closed: Story = {}

/** The picker as it opens: an empty search. */
export const Open: Story = {
  args: { defaultOpen: true },
}

const search = async (canvasElement: HTMLElement, query: string) => {
  const body = within(canvasElement.ownerDocument.body)
  const dialog = within(await body.findByRole('dialog', { name: 'Add an extra' }))
  await userEvent.type(dialog.getByLabelText('Search for an ingredient'), query)
  return dialog
}

/** Catalogue matches, with the household's own words offered beside them. */
export const SearchResults: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, 'wine')
    await expect(await dialog.findByRole('button', { name: 'Pick: Red wine' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Pick: White wine' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Add "wine" as text' })).toBeVisible()
  },
}

/** No ingredient matches, so the words go on the day as free text. */
export const FreeTextFallback: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, 'chips')
    await expect(await dialog.findByText('No ingredient matches "chips".')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Add "chips" as text' })).toBeVisible()
  },
}

/** An ingredient is picked: the optional amount, in its own unit. */
export const AmountStep: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, 'wine')
    await userEvent.click(await dialog.findByRole('button', { name: 'Pick: Red wine' }))
    await expect(dialog.getByLabelText('Amount (optional)')).toHaveFocus()
    await expect(dialog.getByText('ml')).toBeVisible()
  },
}
