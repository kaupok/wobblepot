import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { Toaster } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createMealComponent } from '@/stories/fixtures'
import { EditableIngredientList } from './EditableIngredientList'
import type { EntryChange } from './types'

const ENDPOINT = '/api/meal-plans/:planId/entries/:entryId/components'

/** The bodies the change routes received, newest last. */
const requests: { method: string; url: string; body: unknown }[] = []

const handlers = [
  http.post(ENDPOINT, async ({ request }) => {
    requests.push({ method: 'POST', url: request.url, body: await request.json() })
    return HttpResponse.json({ change: { id: 'new' }, components: [] }, { status: 201 })
  }),
  http.delete(`${ENDPOINT}/:componentId`, ({ request }) => {
    requests.push({ method: 'DELETE', url: request.url, body: null })
    return HttpResponse.json({ components: [] })
  }),
]

const replaced: EntryChange = {
  id: 'change-1',
  original: { id: 'chicken-thigh', name: 'Chicken thigh' },
  replacement: { id: 'salmon-fillet', name: 'Salmon fillet' },
  quantityPerServing: 140,
  stale: false,
}

const meta = {
  title: 'Meal plan/EditableIngredientList',
  component: EditableIngredientList,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    msw: { handlers },
    docs: {
      description: {
        component:
          'The cook view’s ingredient list for one planned entry, with the controls that change this entry only (HON-1243). Each change posts to the entry’s components route, then the planner refreshes from the server.',
      },
    },
  },
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    editable: true,
    servings: 4,
    householdServings: 4,
    components: [
      createMealComponent({ ingredientId: 'salmon-fillet', quantityPerServing: 140 }),
      createMealComponent({ ingredientId: 'potato', quantityPerServing: 200 }),
    ],
    changes: [replaced],
    onChanged: fn(),
  },
  beforeEach: () => {
    requests.length = 0
  },
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-lg border p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EditableIngredientList>

export default meta
type Story = StoryObj<typeof meta>

/** Leave out posts the original alone, and focus lands on "Add an ingredient". */
export const LeaveOut: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change Potato' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Leave out' }))
    await waitFor(() => expect(args.onChanged).toHaveBeenCalledTimes(1))
    await expect(requests).toEqual([
      {
        method: 'POST',
        url: expect.stringContaining('/api/meal-plans/plan-1/entries/entry-1/components'),
        body: {
          originalIngredientId: 'potato',
          replacementIngredientId: null,
          quantityPerServing: null,
        },
      },
    ])
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Add an ingredient' })).toHaveFocus(),
    )
  },
}

export const Undo: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Undo change: Salmon fillet' }))
    await waitFor(() => expect(args.onChanged).toHaveBeenCalledTimes(1))
    await expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ['DELETE', '/api/meal-plans/plan-1/entries/entry-1/components/change-1'],
    ])
  },
}

/** A refusal toasts catalog copy, and nothing else changes. */
export const Refused: Story = {
  // The page's `<Toaster />` lives in the root layout, so this story mounts its own.
  decorators: [
    (Story) => (
      <>
        <Toaster />
        <Story />
      </>
    ),
  ],
  parameters: {
    msw: {
      handlers: [
        http.post(ENDPOINT, () =>
          HttpResponse.json(
            { error: 'This ingredient is already in the meal', code: 'alreadyInMeal' },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Change Potato' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Leave out' }))
    // Found, not checked for visibility: the toast fades in.
    await within(document.body).findByText('This ingredient is already in the meal.')
    await expect(args.onChanged).not.toHaveBeenCalled()
  },
}

/** A cooked or skipped entry: the changes show, the controls do not. */
export const ReadOnly: Story = {
  args: { editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Instead of Chicken thigh')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Undo/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Add an ingredient' })).toBeNull()
  },
}
