import type { Decorator, Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { toast, Toaster } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MealType } from '@/generated/prisma/enums'
import { awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import { lemonGarlicChickenPantry } from '@/stories/fixtures'
import {
  defaultHandlers,
  slowCreateEntryHandlers,
  slowDiscardEntryHandlers,
} from '@/stories/msw-handlers'

import { DayAddMenu } from './DayAddMenu'

const meta = {
  title: 'Feature/Timeline/DayAddMenu',
  component: DayAddMenu,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    date: '2026-04-16',
    dayLabel: 'Thursday Apr 16',
    emptySlots: [MealType.dinner],
    householdServings: 4,
    pantryIngredients: lemonGarlicChickenPantry,
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DayAddMenu>

export default meta
type Story = StoryObj<typeof meta>

const ADD_NAME = 'Add to Thursday Apr 16'

/** Opens the day's menu and picks "Choose a recipe" for dinner (HON-1247). */
async function chooseRecipe(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: ADD_NAME }))
  const dinner = await within(document.body).findByRole('group', { name: 'Dinner' })
  await userEvent.click(within(dinner).getByRole('menuitem', { name: 'Choose a recipe' }))
}

// The button reads "+ Add". Every day with an empty slot has one, so the name
// adds the day after the visible text (HON-807, HON-1335).
export const OneEmptySlot: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: ADD_NAME })
    await expect(button).toBeVisible()
    await expect(button).toHaveTextContent(/^Add$/)
  },
}

/** A day with every slot full shows "+ Extra" alone, not a one-item menu. */
export const NoEmptySlot: Story = {
  args: { emptySlots: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Add an extra: Thursday Apr 16' }),
    ).toHaveTextContent(/^Extra$/)
    await expect(canvas.queryByRole('button', { name: ADD_NAME })).toBeNull()
  },
}

/** Today and Tomorrow have no date beside them, so the day is the word alone. */
export const Tomorrow: Story = {
  args: { date: '2026-04-17', dayLabel: 'Tomorrow', relativeDay: 'tomorrow' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Add to Tomorrow' }),
    ).toBeVisible()
  },
}

/** Estonian: the day follows a separator, so it needs no declension. */
export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Lisa: Thursday Apr 16' }),
    ).toHaveTextContent(/^Lisa$/)
  },
}

export const MenuOpen: Story = {
  args: { emptySlots: [MealType.breakfast, MealType.lunch, MealType.dinner] },
  parameters: {
    docs: {
      description: {
        story:
          'One submenu per empty slot, in slot order, then "Extra" (HON-1341); the play function opens Lunch. "Choose a recipe" opens the selector\'s library view, "Imagine a meal" its imagine view, and each creates the placeholder entry first (HON-1247). "Pick for me" places the top suggestion in one request (HON-1248).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: ADD_NAME })
    await userEvent.click(button)
    const menu = await within(document.body).findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Extra'])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Lunch' }))
    const submenu = await within(document.body).findByRole('menu', { name: 'Lunch' })
    await expect(
      within(submenu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Choose a recipe', 'Pick for me', 'Imagine a meal', 'Fridge meal'])
    await expect(button).toHaveAttribute('aria-expanded', 'true')
  },
}

/**
 * A route chosen by pointer inside a slot's submenu opens the selector for
 * that slot, and focus comes back to "+ Add" on close (HON-1341).
 */
export const RouteFromSubmenu: Story = {
  args: { emptySlots: [MealType.lunch, MealType.dinner] },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: ADD_NAME })
    await userEvent.click(button)
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Dinner' }))
    await userEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Choose a recipe' }),
    )
    await within(document.body).findByRole('dialog', { name: /dinner/i })
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() => expect(document.activeElement).toBe(button))
  },
}

/**
 * A dinner-only day (HON-1518): Dinner's routes stay flat, then Breakfast and
 * Lunch follow a separator as submenus, so one breakfast is a menu step away.
 */
export const OtherMealTypes: Story = {
  args: { emptySlots: [MealType.dinner], otherSlots: [MealType.breakfast, MealType.lunch] },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: ADD_NAME })
    await userEvent.click(button)
    const menu = await within(document.body).findByRole('menu')
    await expect(within(menu).getByRole('group', { name: 'Dinner' })).toBeInTheDocument()
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
      'Fridge meal',
      'Breakfast',
      'Lunch',
      'Extra',
    ])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Breakfast' }))
    await userEvent.click(
      await within(
        await within(document.body).findByRole('menu', { name: 'Breakfast' }),
      ).findByRole('menuitem', { name: 'Choose a recipe' }),
    )
    await within(document.body).findByRole('dialog', { name: /breakfast/i })
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() => expect(document.activeElement).toBe(button))
  },
}

/** "Extra" opens the add-extra dialog, and focus comes back to "+ Add" on close. */
export const ExtraFromMenu: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: ADD_NAME })
    await userEvent.click(button)
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Extra' }))
    await within(document.body).findByRole('dialog', { name: 'Add an extra' })
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() => expect(document.activeElement).toBe(button))
  },
}

export const Adding: Story = {
  parameters: {
    msw: { handlers: slowCreateEntryHandlers },
    docs: {
      description: {
        story:
          "The create-entry POST never resolves, so choosing a route from '+ Add' leaves the button in the 'Adding...' pending state: aria-disabled, so it keeps focus (HON-803).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await chooseRecipe(canvasElement)
    const adding = await canvas.findByRole('button', { name: 'Adding…: Thursday Apr 16' })
    await expect(adding).toHaveAttribute('aria-disabled', 'true')
  },
}

export const Discarding: Story = {
  parameters: {
    msw: { handlers: [...slowDiscardEntryHandlers, ...defaultHandlers] },
    docs: {
      description: {
        story:
          "The selector is closed without a pick and the placeholder DELETE never resolves: the selector closes at once, and '+ Add' stays aria-disabled until the discard settles (HON-799). It is aria-disabled rather than disabled so it can take focus back from the selector (HON-803).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await chooseRecipe(canvasElement)
    const dialog = await within(document.body).findByRole('dialog')
    // The dialog covers the row that was tapped, so its title names the slot,
    // in the short form at this phone viewport (HON-807, HON-941).
    await expect(within(dialog).getByRole('heading', { level: 2 })).toHaveAccessibleName(
      'Dinner for Thu Apr 16',
    )
    await pressEscape()
    await awaitDialogClosed()
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: ADD_NAME })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
  },
}

/**
 * The dinner slot's meal was just cleared, so "+ Add" takes the focus the
 * card took with it (HON-1123).
 */
export const FocusAfterClear: Story = {
  args: { focusSlot: MealType.dinner, onSlotFocused: fn() },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', { name: ADD_NAME })
    await waitFor(() => expect(args.onSlotFocused).toHaveBeenCalledTimes(1))
    await expect(document.activeElement).toBe(button)
  },
}

// "Pick for me" with Undo (HON-1248). The page's `<Toaster />` lives in the
// root layout, so these stories mount their own, as Clear's do.
const withToaster: Decorator = (Story) => (
  <>
    <Toaster />
    <Story />
  </>
)

let pickRequests: { method: string; body: unknown }[] = []

function pickHandlers(pickAnswer: () => Response) {
  return [
    http.post('/api/meal-plans/:planId/entries', async ({ request }) => {
      pickRequests.push({ method: 'POST', body: await request.json() })
      return pickAnswer()
    }),
    http.delete('/api/meal-plans/:planId/entries/:entryId', () => {
      pickRequests.push({ method: 'DELETE', body: null })
      return HttpResponse.json({ success: true })
    }),
  ]
}

async function pickForMe(canvasElement: HTMLElement) {
  pickRequests = []
  // Sonner's toasts are module state, so the previous story's toast is still
  // there.
  toast.dismiss()
  await userEvent.click(within(canvasElement).getByRole('button', { name: ADD_NAME }))
  await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Pick for me' }))
}

/**
 * One tap places the top suggestion; a toast names it and offers Undo for six
 * seconds, and Undo deletes the entry.
 */
export const PickForMeWithUndo: Story = {
  decorators: [withToaster],
  parameters: {
    msw: {
      handlers: pickHandlers(() =>
        HttpResponse.json({
          id: 'entry-9',
          date: '2026-04-16',
          mealType: 'dinner',
          status: 'planned',
          mealId: 'meal-7',
          note: null,
          mealName: 'Fish pie',
        }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    await pickForMe(canvasElement)
    const body = within(document.body)
    await expect(await body.findByText('Picked for you: Fish pie')).toBeInTheDocument()
    await expect(pickRequests).toEqual([
      { method: 'POST', body: { date: '2026-04-16', mealType: 'dinner', pick: 'suggested' } },
    ])
    await userEvent.click(body.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(pickRequests.at(-1)).toEqual({ method: 'DELETE', body: null }))
  },
}

/** No meal passes the household's filters: nothing is written, and the toast sends the user to the picker. */
export const PickForMeNoMatch: Story = {
  decorators: [withToaster],
  parameters: {
    msw: {
      handlers: pickHandlers(() =>
        HttpResponse.json(
          { error: 'No meals available matching your preferences', code: 'no_suggestions' },
          { status: 404 },
        ),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    await pickForMe(canvasElement)
    await expect(
      await within(document.body).findByText(
        'No meal fits this slot yet. Choose a recipe instead.',
      ),
    ).toBeInTheDocument()
  },
}
