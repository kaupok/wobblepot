import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
  openViaTrigger,
  pressEscape,
} from '@/stories/a11y-helpers'
import { fridgeItems, fridgePantryItems } from '@/stories/fridge-fixtures'
import { expectFocusRingRoom } from '@/stories/layout-helpers'
import { FridgeMealPicker } from './FridgeMealPicker'

const meta = {
  title: 'Meal plan/Fridge meal/FridgeMealPicker',
  component: FridgeMealPicker,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Plans a meal from what is at home (HON-1277): pantry items, leftovers from a meal eaten in the last 3 days, and free text. Items have no quantities, and nothing goes on the shopping list. Portal-based.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    onSaved: fn(),
    planId: 'plan-1',
    date: '2026-10-21',
    mealType: 'dinner',
    pantryItems: fridgePantryItems,
  },
} satisfies Meta<typeof FridgeMealPicker>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing chosen yet: the pantry, the recent meals and the free-text field. */
export const Empty: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    await expect(dialog.getByText('Nothing added yet.')).toBeInTheDocument()
    await expect(
      await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }),
    ).toBeInTheDocument()
    await expect(dialog.getByRole('button', { name: 'Add: Cucumber' })).toBeInTheDocument()
  },
}

/**
 * A log on Past meals (HON-1383): the household's own words of the last 30
 * days are one-tap chips, so "Wolt" stays one label. A chip in the meal
 * leaves the list, and focus moves to the search, not the body.
 */
export const RecentLabels: Story = {
  args: { recentLabels: ['Wolt', 'pelmeenid'], logPast: true },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    const labels = within(dialog.getByRole('region', { name: 'Used lately' }))

    await userEvent.click(labels.getByRole('button', { name: 'Add: Wolt' }))

    const chosen = within(dialog.getByRole('region', { name: 'In this meal' }))
    await expect(chosen.getByText('Wolt')).toBeInTheDocument()
    await expect(labels.queryByRole('button', { name: 'Add: Wolt' })).not.toBeInTheDocument()
    await expect(dialog.getByRole('searchbox', { name: 'Search the pantry' })).toHaveFocus()
  },
}

/** Editing a fridge meal with one item of each source. */
export const MixedItems: Story = {
  args: { entryId: 'entry-1', initialItems: fridgeItems },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    const chosen = within(dialog.getByRole('region', { name: 'In this meal' }))
    // Only the pantry items carry the marker: they get a "Used it all" tick later.
    await expect(chosen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Mash, from Tuesday',
      'Cauliflower and broccoli mixpantry',
      'Cucumberpantry',
      'store meatballs',
    ])
  },
}

/** A search with no pantry match offers to add the words as an item (HON-1287). */
export const NoMatch: Story = {
  args: { pantryItems: fridgePantryItems.filter((p) => p.ingredientId !== 'cucumber') },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    const search = dialog.getByLabelText('Search the pantry')
    await userEvent.type(search, 'cucumber')
    await expect(dialog.getByText('Nothing in the pantry matches "cucumber".')).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Add "cucumber"' }))
    const chosen = within(dialog.getByRole('region', { name: 'In this meal' }))
    await expect(chosen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['cucumber'])
    await expect(search).toHaveValue('')
    await expect(search).toHaveFocus()
    // Left showing for the axe gate and the screenshot.
    await userEvent.type(search, 'tofu')
    await expect(dialog.getByRole('button', { name: 'Add "tofu"' })).toBeInTheDocument()
  },
}

/** The same in Estonian: „…“ quotes. */
export const NoMatchEt: Story = {
  args: { pantryItems: fridgePantryItems.filter((p) => p.ingredientId !== 'cucumber') },
  globals: { locale: 'et' },
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole('dialog', { name: 'Külmkapitoit' }),
    )
    await userEvent.type(dialog.getByLabelText('Otsi sahvrist'), 'kurk')
    await expect(
      dialog.getByText('Sahvris pole midagi, mis sobiks otsinguga „kurk“.'),
    ).toBeInTheDocument()
    await expect(dialog.getByRole('button', { name: 'Lisa „kurk“' })).toBeInTheDocument()
  },
}

export const EmptyPantry: Story = {
  args: { pantryItems: [] },
  parameters: {
    msw: { handlers: [http.get('/api/entries/recent', () => HttpResponse.json({ meals: [] }))] },
  },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    await expect(
      dialog.getByText('Your pantry is empty. Add something below instead.'),
    ).toBeInTheDocument()
    await expect(await dialog.findByText('No meals eaten in the last 3 days.')).toBeInTheDocument()
  },
}

/** Search, add from each source, and save: the slot's create request. */
export const AddAndSave: Story = {
  play: async ({ args }) => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    await userEvent.type(dialog.getByLabelText('Search the pantry'), 'cuc')
    await userEvent.click(dialog.getByRole('button', { name: 'Add: Cucumber' }))
    await userEvent.click(await dialog.findByRole('button', { name: 'Add: Mash, from Tuesday' }))
    await userEvent.type(dialog.getByLabelText('Something else'), 'store meatballs{Enter}')
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onSaved).toHaveBeenCalledTimes(1))
    await expect(args.onOpenChange).toHaveBeenCalledWith(false)
  },
}

/** Save with nothing chosen asks for an item and sends nothing. */
export const NeedsAnItem: Story = {
  play: async ({ args }) => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await expect(dialog.getByText('Add at least one item, then save.')).toBeInTheDocument()
    await expect(args.onSaved).not.toHaveBeenCalled()
  },
}

/**
 * Every field and button in the scroll area keeps room for its 3px focus ring,
 * the top and bottom controls included, with no horizontal scroll (HON-1353).
 */
export const FocusRingRoom: Story = {
  args: { entryId: 'entry-1', initialItems: fridgeItems },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Fridge meal' }))
    // The recent meals load last; wait so the scroll area has its full height.
    await dialog.findByRole('button', { name: /^Add: Lentil soup/ })
    const search = dialog.getByLabelText('Search the pantry')
    let scrollArea = search.parentElement
    while (scrollArea && getComputedStyle(scrollArea).overflowY !== 'auto') {
      scrollArea = scrollArea.parentElement
    }
    if (!scrollArea) throw new Error('No scroll area around "Search the pantry"')
    await expect(scrollArea.scrollHeight).toBeGreaterThan(scrollArea.clientHeight)
    await expect(scrollArea.scrollWidth).toBeLessThanOrEqual(scrollArea.clientWidth)
    const controls = Array.from(scrollArea.querySelectorAll<HTMLElement>('input, button'))
    await expect(controls).toContain(dialog.getByLabelText('Something else'))
    await expect(controls).toContain(dialog.getByRole('button', { name: 'Add' }))
    for (const control of controls) expectFocusRingRoom(control, scrollArea)
  },
}

export const A11yInteractionPatterns: Story = {
  args: { open: false },
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false)
    return (
      <div>
        <button type="button" data-testid="a11y-trigger" onClick={() => setOpen(true)}>
          Open picker
        </button>
        <FridgeMealPicker
          {...args}
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            args.onOpenChange?.(next)
          }}
        />
      </div>
    )
  },
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByTestId('a11y-trigger')
    await openViaTrigger(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()
    await pressEscape()
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false))
    await awaitDialogClosed()
  },
}
