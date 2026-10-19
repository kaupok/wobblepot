import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { Toaster } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { EntryChange } from './types'
import { PromoteEntry } from './PromoteEntry'

const PROMOTE = '/api/meal-plans/:planId/entries/:entryId/components/promote'

/** The POST bodies the promote route received, newest last. */
const sent: unknown[] = []

const answer = (body: Record<string, unknown>, status = 200) => [
  http.post(PROMOTE, async ({ request }) => {
    sent.push(await request.json())
    return HttpResponse.json(body, { status })
  }),
]

const garlicLeftOut: EntryChange = {
  id: 'change-1',
  original: { id: 'garlic', name: 'Garlic' },
  replacement: null,
  quantityPerServing: null,
  stale: false,
}

const meta = {
  title: 'Meal plan/PromoteEntry',
  component: PromoteEntry,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    msw: { handlers: answer({ outcome: 'forked', mealId: 'meal-new' }) },
    docs: {
      description: {
        component:
          '"Make it my recipe" under a planned entry’s ingredients (HON-1245): keeps its changes for good. A library meal becomes a new household recipe that the entry then uses; the household’s own recipe gets "Update the recipe". Hidden while no change applies.',
      },
    },
  },
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    changes: [garlicLeftOut],
    isCustom: false,
    mealName: 'Tuna pasta with garlic and chilli',
    onChanged: fn(),
  },
  beforeEach: () => {
    sent.length = 0
  },
  decorators: [
    (Story) => (
      <div className="flex max-w-md flex-col rounded-lg border p-4">
        <Story />
        <Toaster />
      </div>
    ),
  ],
} satisfies Meta<typeof PromoteEntry>

export default meta
type Story = StoryObj<typeof meta>

/** A library meal: the dialog saves a new recipe and the entry moves to it. */
export const MakeItMyRecipe: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Make it my recipe' }))
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Make it my recipe' })
    await userEvent.click(body.getByRole('button', { name: 'Save to My recipes' }))
    await waitFor(() => expect(args.onChanged).toHaveBeenCalled())
    await expect(sent).toEqual([{ name: 'Tuna pasta with garlic and chilli (my version)' }])
    await expect(await body.findByText('Saved to My recipes')).toBeInTheDocument()
  },
}

/** The household's own recipe: the action updates it. */
export const UpdateTheRecipe: Story = {
  args: { isCustom: true, mealName: 'Tuna pasta (my version)' },
  parameters: { msw: { handlers: answer({ outcome: 'updated', mealId: 'meal-own' }) } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Update the recipe' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Update the recipe' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update the recipe' }))
    await expect(await within(document.body).findByText('Recipe updated')).toBeInTheDocument()
  },
}

/** A refusal shows catalog copy and keeps the dialog open. */
export const Refused: Story = {
  parameters: {
    msw: { handlers: answer({ error: 'The entry has no change to keep', code: 'noChanges' }, 409) },
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Make it my recipe' }))
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Make it my recipe' })
    await userEvent.click(body.getByRole('button', { name: 'Save to My recipes' }))
    await expect(await body.findByText('This meal has no changes to keep.')).toBeInTheDocument()
    await expect(body.getByRole('dialog')).toBeInTheDocument()
    await expect(args.onChanged).not.toHaveBeenCalled()
  },
}

/** Only stale changes: nothing applies, so there is nothing to keep. */
export const HiddenWithOnlyStaleChanges: Story = {
  args: { changes: [{ ...garlicLeftOut, stale: true }] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}
