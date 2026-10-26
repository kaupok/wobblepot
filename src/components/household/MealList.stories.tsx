import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { toast, Toaster } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { householdMealList } from '@/stories/fixtures'
import { MealList, type MealData } from './MealList'

const meta = {
  title: 'Feature/Household/MealList',
  component: MealList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Renders the user’s custom meals as a responsive grid of cards (one column on a phone, two from `sm`, three from `lg`). Each card’s title row holds the favorite button and a ⋯ “More actions” menu with Edit (a link) and Delete, as on the planner card (HON-934) and carries no ingredient list at any width (HON-819): the edit page and meal detail list them with quantities. Deletion goes through a confirm dialog, which returns focus to the card’s ⋯ trigger on cancel and to the next card’s after a delete. The delete toast offers Undo, and a collapsed “Recently deleted” section at the end lists recipes deleted in the last 30 days with a Restore button each (HON-1336); it renders only when there is one. Mutations call `/api/meals/:id/favorite`, `/api/households/me/meals/:id` (DELETE) and `/api/households/me/meals/:id/restore`, and the section reads `/api/households/me/meals/deleted` — all backed by MSW in stories.',
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

/**
 * Empty state: one muted line and the page's one primary action under it.
 * `/recipes` passes an "Add recipe" link as `emptyAction` (HON-1128, HON-1271).
 */
export const Empty: Story = {
  args: {
    meals: [],
    emptyAction: (
      <Button asChild>
        <a href="/recipes/import">Add recipe</a>
      </Button>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Empty library — one line saying what is true and what to do next, and the `emptyAction` button under it.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        'No recipes yet. Add a family favourite, import one from a link, or imagine one.',
      ),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Add recipe' })).toHaveAttribute(
      'href',
      '/recipes/import',
    )
  },
}

/** Without `emptyAction` the empty state is the line alone. */
export const EmptyWithoutAction: Story = {
  args: { meals: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('link')).toBeNull()
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
    expect(canvas.getAllByRole('button', { name: /favourites/i })).toHaveLength(names.length)
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

const DELETED_AT = '2026-10-24T09:00:00.000Z'

/**
 * Recipes deleted in the last 30 days: the section sits closed at the end of
 * the list, with the count on its trigger, and opens to one row per recipe.
 */
export const WithRecentlyDeleted: Story = {
  args: { meals: householdMealList.slice(1) },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/households/me/meals/deleted', () =>
          HttpResponse.json({
            meals: [
              { id: FIRST.id, name: FIRST.name, deletedAt: DELETED_AT },
              { id: 'meal-old', name: 'Rice soup', deletedAt: '2026-10-02T09:00:00.000Z' },
            ],
          }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByRole('button', { name: 'Recently deleted (2)' })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)

    await expect(canvas.getByText('Deleted Oct 24')).toBeVisible()
    await expect(canvas.getByRole('button', { name: `Restore: ${FIRST.name}` })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Restore: Rice soup' })).toBeVisible()
  },
}

/** Nothing deleted in the last 30 days: no section at all. */
export const WithoutRecentlyDeleted: Story = {
  play: async ({ canvasElement }) => {
    // Past the section's fetch, so an absent trigger is not just a slow one.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(
      within(canvasElement).queryByRole('button', { name: /Recently deleted/ }),
    ).toBeNull()
  },
}

/**
 * An in-story backend for the restore flows: DELETE marks a recipe deleted,
 * restore brings it back, and the list and the section read the same set.
 * `beforeEach` reseeds it, so a re-run starts from the same state.
 */
const deletedIds = new Set<string>()
const liveBackend = [
  http.get('/api/households/me/meals', () =>
    HttpResponse.json({
      meals: householdMealList.filter((meal) => !deletedIds.has(meal.id)),
      nextCursor: null,
    }),
  ),
  http.get('/api/households/me/meals/deleted', () =>
    HttpResponse.json({
      meals: householdMealList
        .filter((meal) => deletedIds.has(meal.id))
        .map((meal) => ({ id: meal.id, name: meal.name, deletedAt: DELETED_AT })),
    }),
  ),
  http.delete('/api/households/me/meals/:id', ({ params }) => {
    deletedIds.add(String(params.id))
    return HttpResponse.json({ success: true })
  }),
  http.post('/api/households/me/meals/:id/restore', ({ params }) => {
    deletedIds.delete(String(params.id))
    return HttpResponse.json({ id: params.id, deletedAt: null })
  }),
]

/** The list as `/recipes` feeds it: from `['meals']`, which a restore refetches. */
function LiveMealList(args: React.ComponentProps<typeof MealList>) {
  const queryClient = useQueryClient()
  const queryKey = ['meals', 'story']
  const { data } = useQuery({
    queryKey,
    queryFn: () => apiFetch<{ meals: MealData[] }>('/api/households/me/meals'),
  })
  if (!data) return null
  return (
    <>
      <MealList
        {...args}
        meals={data.meals}
        onDelete={(id) => {
          args.onDelete(id)
          queryClient.setQueryData<{ meals: MealData[] }>(queryKey, (old) =>
            old ? { meals: old.meals.filter((meal) => meal.id !== id) } : old,
          )
        }}
      />
      {/* The app's toaster sits in the root layout, not in the list. */}
      <Toaster />
    </>
  )
}

/**
 * Delete, then Undo in the toast: the recipe is back in the list and focus is
 * on its ⋯ trigger, not the page body.
 */
export const UndoRestoresTheRecipe: Story = {
  parameters: { msw: { handlers: liveBackend } },
  beforeEach: () => {
    deletedIds.clear()
    // Sonner's toasts are global: earlier stories' delete toasts would show
    // here too, each with its own Undo.
    toast.dismiss()
  },
  render: (args) => <LiveMealList {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: `More actions: ${FIRST.name}` })
    const { dialog } = await chooseDelete(canvasElement, FIRST.name)
    await userEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    // The dialog's exit animation hands focus to the next card's ⋯ when it
    // ends; a person reaches Undo after that.
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: `More actions: ${SECOND.name}` })).toHaveFocus(),
    )

    await userEvent.click(await within(document.body).findByRole('button', { name: 'Undo' }))

    const trigger = await canvas.findByRole('button', { name: `More actions: ${FIRST.name}` })
    await waitFor(() => expect(trigger).toHaveFocus())
    // The toast fades in, so wait for its enter animation.
    const restored = await within(document.body).findByText('Recipe restored')
    await waitFor(() => expect(restored).toBeVisible())
  },
}

/**
 * Restore from Recently deleted: the recipe is back in the list. It was the
 * only row, so the section goes and focus moves to the restored card's ⋯.
 */
export const RestoreFromRecentlyDeleted: Story = {
  parameters: { msw: { handlers: liveBackend } },
  beforeEach: () => {
    deletedIds.clear()
    deletedIds.add(FIRST.id)
    toast.dismiss()
  },
  render: (args) => <LiveMealList {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Recently deleted (1)' }))

    await userEvent.click(canvas.getByRole('button', { name: `Restore: ${FIRST.name}` }))

    const trigger = await canvas.findByRole('button', { name: `More actions: ${FIRST.name}` })
    await waitFor(() => expect(trigger).toHaveFocus())
    await expect(canvas.queryByRole('button', { name: /Recently deleted/ })).toBeNull()
  },
}
