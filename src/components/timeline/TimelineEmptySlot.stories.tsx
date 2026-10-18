import type { Decorator, Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import { Toaster, toast } from 'sonner'
import { MealType } from '@/generated/prisma/enums'
import { lemonGarlicChickenPantry } from '@/stories/fixtures'
import {
  defaultHandlers,
  slowCreateEntryHandlers,
  slowDiscardEntryHandlers,
} from '@/stories/msw-handlers'
import { awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import { TimelineEmptySlot } from './TimelineEmptySlot'

const meta = {
  title: 'Feature/Timeline/TimelineEmptySlot',
  component: TimelineEmptySlot,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    date: '2026-04-16',
    dayLabel: 'Thursday Apr 16',
    mealType: MealType.dinner,
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
} satisfies Meta<typeof TimelineEmptySlot>

export default meta
type Story = StoryObj<typeof meta>

/** Opens the slot's menu and picks "Choose a recipe" (HON-1247). */
async function chooseRecipe(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Dinner: pick a meal/ }))
  await userEvent.click(
    await within(document.body).findByRole('menuitem', { name: 'Choose a recipe' }),
  )
}

// The button's text is the meal type ("+ Dinner"). Every empty day has one, so
// the name adds the action and the day after the visible text (HON-807,
// HON-1111).
export const Dinner: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', {
        name: 'Dinner: pick a meal, Thursday Apr 16',
      }),
    ).toBeVisible()
  },
}

export const Lunch: Story = {
  args: { mealType: MealType.lunch },
}

export const Breakfast: Story = {
  args: { mealType: MealType.breakfast },
}

/** Today and Tomorrow have no date beside them, so the day is the word alone. */
export const Tomorrow: Story = {
  args: { date: '2026-04-17', dayLabel: 'Tomorrow', relativeDay: 'tomorrow' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Dinner: pick a meal, Tomorrow' }),
    ).toBeVisible()
  },
}

/** Estonian: the meal type is the whole visible text, so it needs no declension. */
export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Õhtusöök: vali toit, Thursday Apr 16' }),
    ).toHaveTextContent('Õhtusöök')
  },
}

export const MenuOpen: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The slot\'s button opens the routes to a meal: "Choose a recipe" opens the selector\'s library view, "Imagine a meal" its imagine view, and each creates the placeholder entry first (HON-1247). "Pick for me" places the top suggestion in one request (HON-1248).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Dinner: pick a meal, Thursday Apr 16',
    })
    await userEvent.click(button)
    const menu = await within(document.body).findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    await expect(items.map((item) => item.textContent)).toEqual([
      'Choose a recipe',
      'Pick for me',
      'Imagine a meal',
    ])
    await expect(button).toHaveAttribute('aria-expanded', 'true')
  },
}

export const Adding: Story = {
  parameters: {
    msw: { handlers: slowCreateEntryHandlers },
    docs: {
      description: {
        story:
          "The create-entry POST never resolves, so choosing a route from '+ Dinner' leaves the button in the 'Adding...' pending state: aria-disabled, so it keeps focus (HON-803).",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await chooseRecipe(canvasElement)
    const adding = await canvas.findByRole('button', {
      name: 'Adding…: Thursday Apr 16, Dinner',
    })
    await expect(adding).toHaveAttribute('aria-disabled', 'true')
  },
}

export const Discarding: Story = {
  parameters: {
    msw: { handlers: [...slowDiscardEntryHandlers, ...defaultHandlers] },
    docs: {
      description: {
        story:
          "The selector is closed without a pick and the placeholder DELETE never resolves: the selector closes at once, and '+ Dinner' stays aria-disabled until the discard settles (HON-799). It is aria-disabled rather than disabled so it can take focus back from the selector (HON-803).",
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
      expect(canvas.getByRole('button', { name: /^Dinner: pick a meal/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
  },
}

/**
 * The slot replaces a card whose meal was just cleared, so it takes the
 * focus the card took with it (HON-1123).
 */
export const AutoFocus: Story = {
  args: { autoFocus: true, onAutoFocused: fn() },
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Dinner: pick a meal, Thursday Apr 16',
    })
    await waitFor(() => expect(args.onAutoFocused).toHaveBeenCalledTimes(1))
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
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Dinner: pick a meal/ }))
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
