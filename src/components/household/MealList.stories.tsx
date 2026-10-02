import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Input } from '@/components/ui/input'
import { householdMealList } from '@/stories/fixtures'
import { MealList } from './MealList'

const meta = {
  title: 'Feature/Household/MealList',
  component: MealList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Renders the user’s custom meals as a responsive grid of cards (one column on a phone, two from `sm`, three from `lg`). Each card’s title row holds the favorite button and a ⋯ “More actions” menu with Edit (a link) and Delete, as on the planner card (HON-934) and carries no ingredient list at any width (HON-819): the edit page and meal detail list them with quantities. Deletion goes through a confirm dialog, which returns focus to the card’s ⋯ trigger on cancel and to the next card’s after a delete. Mutations call `/api/meals/:id/favorite` and `/api/households/me/meals/:id` (DELETE) — both backed by MSW in stories.',
      },
    },
  },
  args: {
    meals: householdMealList,
    onDelete: fn(),
    onToggleFavorite: fn(),
  },
} satisfies Meta<typeof MealList>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { meals: [] },
  parameters: {
    docs: {
      description: {
        story: 'Empty state — verbiage encourages the user to create their first recipe.',
      },
    },
  },
}

export const Populated: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Three-meal mix — poultry, fish (favorited), and vegetarian — for the visual baseline.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const names = await canvas.findAllByRole('heading', { level: 2 })
    expect(names).toHaveLength(householdMealList.length)

    // No ingredient list in the DOM, hidden or not (HON-819).
    expect(canvasElement.querySelector('ul')).toBeNull()
    for (const component of householdMealList.flatMap((m) => m.components)) {
      expect(canvas.queryByText(component.ingredient.name)).toBeNull()
    }

    // Two controls on every title row: the heart and the ⋯ trigger, named
    // for its recipe. Edit and Delete live in the menu (HON-934).
    expect(canvas.getAllByRole('button', { name: /favorites/i })).toHaveLength(names.length)
    for (const meal of householdMealList) {
      expect(canvas.getByRole('button', { name: `More actions: ${meal.name}` })).toBeInTheDocument()
    }
    expect(canvas.getAllByRole('button')).toHaveLength(names.length * 2)
    expect(canvas.queryAllByRole('link')).toHaveLength(0)
  },
}

export const WithSearch: Story = {
  args: {
    meals: householdMealList.slice(0, 1),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Single meal — represents the post-search filter state where only one match remains.',
      },
    },
  },
}

const FIRST = householdMealList[0]!
const SECOND = householdMealList[1]!

async function chooseDelete(canvasElement: HTMLElement, mealName: string) {
  const trigger = within(canvasElement).getByRole('button', { name: `More actions: ${mealName}` })
  await userEvent.click(trigger)
  await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Delete' }))
  const dialog = await within(document.body).findByRole('alertdialog')
  return { trigger, dialog }
}

/** Edit is a real link to the edit page, so open-in-new-tab works. */
export const EditIsALink: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: `More actions: ${FIRST.name}` }))
    const body = within(document.body)
    const menu = await body.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Edit', 'Delete'])
    expect(items[0]!.tagName).toBe('A')
    expect(items[0]).toHaveAttribute('href', `/recipes/${FIRST.id}/edit`)
    expect(items[1]).toHaveAttribute('data-variant', 'destructive')
  },
}

// Play story — exercises the delete-confirmation contract end-to-end:
// ⋯ → Delete → confirm dialog opens → click Delete → MSW resolves the DELETE →
// onDelete fires with the meal id. The card's trigger is gone after a real
// delete, so focus moves to the next card's trigger rather than the body.

export const DeleteConfirmInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const { dialog } = await chooseDelete(canvasElement, FIRST.name)
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(args.onDelete).toHaveBeenCalledWith(FIRST.id))
    // The trigger is queried hidden: the open dialog sets `aria-hidden` on the
    // page behind it until it unmounts.
    const next = within(canvasElement).getByRole('button', {
      name: `More actions: ${SECOND.name}`,
      hidden: true,
    })
    await waitFor(() => expect(document.activeElement).toBe(next))
  },
}

/**
 * The dialog opens from a menu item that is gone when it closes, so Radix has
 * no trigger to return focus to. Cancel and Escape both put it back on the ⋯
 * trigger Delete was chosen from, not the page body (HON-934).
 */
export const CancelReturnsFocusToTrigger: Story = {
  play: async ({ args, canvasElement }) => {
    const first = await chooseDelete(canvasElement, FIRST.name)
    await userEvent.click(within(first.dialog).getByRole('button', { name: /^cancel$/i }))
    await waitFor(() => expect(document.activeElement).toBe(first.trigger))

    const second = await chooseDelete(canvasElement, SECOND.name)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(second.trigger))

    expect(args.onDelete).not.toHaveBeenCalled()
  },
}

/**
 * Deleting the last card leaves no trigger to land on, and the empty state
 * unmounts the dialog outright. Focus goes to `emptyFocusRef`, the page's
 * search field on `/recipes`, rather than the body.
 */
export const LastDeleteFocusesFallback: Story = {
  args: { meals: householdMealList.slice(0, 1) },
  render: function Render(args) {
    const [meals, setMeals] = useState(args.meals)
    const searchRef = useRef<HTMLInputElement>(null)
    return (
      <div className="flex flex-col gap-4">
        <Input ref={searchRef} type="search" aria-label="Search recipes" />
        <MealList
          {...args}
          meals={meals}
          emptyFocusRef={searchRef}
          onDelete={(id) => {
            args.onDelete(id)
            setMeals((current) => current.filter((meal) => meal.id !== id))
          }}
        />
      </div>
    )
  },
  play: async ({ args, canvasElement }) => {
    const { dialog } = await chooseDelete(canvasElement, FIRST.name)
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(args.onDelete).toHaveBeenCalledWith(FIRST.id))
    const search = within(canvasElement).getByRole('searchbox', { hidden: true })
    await waitFor(() => expect(document.activeElement).toBe(search))
  },
}

/**
 * While the DELETE is in flight Cancel is disabled and Escape is ignored: a
 * close there would focus the deleting card's own trigger, which the delete
 * then unmounts, dropping focus to the body.
 */
export const EscapeIgnoredWhileDeleting: Story = {
  parameters: {
    msw: {
      handlers: [
        http.delete('/api/households/me/meals/:id', async () => {
          await delay('infinite')
          return HttpResponse.json({ ok: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const { dialog } = await chooseDelete(canvasElement, FIRST.name)
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /^cancel$/i })).toBeDisabled(),
    )

    // A closing dialog stays in the DOM through its 200ms exit animation, so
    // check its state after that window rather than its presence.
    await userEvent.keyboard('{Escape}')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(dialog).toBeInTheDocument()
    await expect(dialog).toHaveAttribute('data-state', 'open')
  },
}
