import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { AdjustProposal } from '@/lib/meal-planning/adjust-proposal'
import { createMealComponent } from '@/stories/fixtures'

import { AdjustRecipe, type AdjustRecipeProps } from './AdjustRecipe'

const ADJUST = '/api/meal-plans/:planId/entries/:entryId/adjust'
const COMPONENTS = '/api/meal-plans/:planId/entries/:entryId/components'

/** The PUT bodies the components route received, newest last. */
const applied: unknown[] = []

const toSalmon: AdjustProposal = {
  op: 'replace',
  original: { id: 'chicken-thigh', name: 'Chicken thigh' },
  originalIngredientId: 'chicken-thigh',
  replacesChangeId: null,
  replacement: {
    matched: true,
    ingredient: {
      id: 'salmon-fillet',
      name: 'Salmon fillet',
      defaultUnit: 'g',
      measuredByVolume: false,
    },
    quantityPerServing: 140,
  },
  reason: 'Salmon cooks in the same time and suits the lemon.',
}

const answer = (body: Record<string, unknown>, status = 200) => [
  http.post(ADJUST, () => HttpResponse.json(body, { status })),
  http.put(COMPONENTS, async ({ request }) => {
    applied.push(await request.json())
    return HttpResponse.json({ components: [] })
  }),
]

/**
 * Owns `open` as `MealDetailModal` does, with a stand-in for its ⋯ trigger
 * that opens the section and takes focus back on Close (HON-1356).
 */
function WithTrigger(args: AdjustRecipeProps) {
  const [open, setOpen] = useState(args.open)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <div className="flex flex-col gap-4">
      <button ref={triggerRef} type="button" className="self-start" onClick={() => setOpen(true)}>
        Open Adjust recipe
      </button>
      <AdjustRecipe
        {...args}
        open={open}
        fieldRef={fieldRef}
        onClose={() => {
          args.onClose()
          setOpen(false)
          triggerRef.current?.focus()
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Meal plan/AdjustRecipe',
  component: AdjustRecipe,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    msw: { handlers: answer({ changes: [toSalmon], followInSteps: false, unmatched: [] }) },
    docs: {
      description: {
        component:
          '"Adjust recipe" on a planned entry (HON-1244): the household says what to change, the AI proposes ingredient changes, and the review dialog applies the ones it keeps as the entry’s change set. An instruction that needs no change says so and writes nothing. The cook view’s ⋯ menu opens the section on request (HON-1356); closed, only a stored request shows.',
      },
    },
  },
  args: {
    planId: 'plan-1',
    entryId: 'entry-1',
    changes: [],
    components: [
      createMealComponent({ ingredientId: 'chicken-thigh', quantityPerServing: 150 }),
      createMealComponent({ ingredientId: 'lemon', quantityPerServing: 0.25 }),
    ],
    adjustmentNote: null,
    onChanged: fn(),
    open: true,
    onClose: fn(),
    fieldRef: { current: null },
  },
  render: (args) => <WithTrigger {...args} />,
  beforeEach: () => {
    applied.length = 0
  },
  decorators: [
    (Story) => (
      <div className="max-w-md rounded-lg border p-4">
        <Story />
        <Toaster />
      </div>
    ),
  ],
} satisfies Meta<typeof AdjustRecipe>

export default meta
type Story = StoryObj<typeof meta>

async function ask(canvasElement: HTMLElement, text: string) {
  const canvas = within(canvasElement)
  await userEvent.type(canvas.getByRole('textbox', { name: 'Adjust recipe' }), text)
  await userEvent.click(canvas.getByRole('button', { name: 'Suggest changes' }))
}

export const Default: Story = {}

/** The proposals open the review; Apply stores them with the instruction. */
export const ReviewAndApply: Story = {
  play: async ({ canvasElement, args }) => {
    await ask(canvasElement, 'Fish instead of chicken')
    const body = within(document.body)
    await body.findByRole('dialog', { name: 'Suggested changes' })
    await userEvent.click(body.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(args.onChanged).toHaveBeenCalled())
    await waitFor(() => expect(args.onClose).toHaveBeenCalled())
    await expect(applied).toEqual([
      {
        changes: [
          {
            originalIngredientId: 'chicken-thigh',
            replacementIngredientId: 'salmon-fillet',
            quantityPerServing: 140,
          },
        ],
        basedOn: [],
        adjustmentNote: 'Fish instead of chicken',
        noteMode: 'append',
      },
    ])
  },
}

/** An empty answer: the box says no change is needed, and nothing is written. */
export const NoChangeNeeded: Story = {
  parameters: { msw: { handlers: answer({ changes: [], followInSteps: false, unmatched: [] }) } },
  play: async ({ canvasElement }) => {
    await ask(canvasElement, 'Make it with chicken')
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('status')).toHaveTextContent(
      'No ingredient change is needed for that.',
    )
    await expect(applied).toEqual([])
  },
}

/** "Less salt" with no salt listed: the steps alone follow it, on "Use in the steps". */
export const StepsOnly: Story = {
  parameters: { msw: { handlers: answer({ changes: [], followInSteps: true, unmatched: [] }) } },
  play: async ({ canvasElement, args }) => {
    await ask(canvasElement, 'Less salt, a toddler eats with us')
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Use in the steps' }))
    await waitFor(() => expect(args.onChanged).toHaveBeenCalled())
    await waitFor(() => expect(args.onClose).toHaveBeenCalled())
    await expect(applied).toEqual([
      {
        changes: [],
        basedOn: [],
        adjustmentNote: 'Less salt, a toddler eats with us',
        noteMode: 'append',
      },
    ])
  },
}

/** A stored request, shown with Clear. */
export const WithStoredRequest: Story = {
  args: { adjustmentNote: 'Less salt\nFish instead of chicken' },
}

/** The default in the cook view: closed, and nothing shows. */
export const Closed: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
    await expect(canvas.queryByText('Adjust recipe')).not.toBeInTheDocument()
  },
}

/** Closed with a stored request: the line stays, because it explains the steps. */
export const ClosedWithStoredRequest: Story = {
  args: { open: false, adjustmentNote: 'Less salt' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('The steps follow your request: Less salt')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Clear request' })).toBeVisible()
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
  },
}

/** Close hides the section and returns focus to what opened it. */
export const CloseReturnsFocus: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Close Adjust recipe' }))
    await expect(args.onClose).toHaveBeenCalled()
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Open Adjust recipe' })).toHaveFocus()
  },
}

/** A refusal renders catalog copy, never the route's English `error`. */
export const RateLimited: Story = {
  parameters: {
    msw: {
      handlers: answer({ error: 'Rate limit exceeded', code: 'rate_limited' }, 429),
    },
  },
  play: async ({ canvasElement }) => {
    await ask(canvasElement, 'No chicken')
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(
        "You've reached this hour's limit for recipe adjustments. Please try again later.",
      ),
    ).toBeInTheDocument()
  },
}
