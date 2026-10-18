import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { Toaster } from 'sonner'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createMealComponent } from '@/stories/fixtures'
import type { AdjustProposal } from '@/lib/meal-planning/adjust-proposal'
import { AdjustRecipe } from './AdjustRecipe'

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

const meta = {
  title: 'Meal plan/AdjustRecipe',
  component: AdjustRecipe,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    msw: { handlers: answer({ changes: [toSalmon], unmatched: [] }) },
    docs: {
      description: {
        component:
          '"Adjust recipe" on a planned entry (HON-1244): the household says what to change, the AI proposes ingredient changes, and the review dialog applies the ones it keeps as the entry’s change set. An instruction that needs no change says so and writes nothing.',
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
    onChanged: fn(),
  },
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
      },
    ])
  },
}

/** An empty answer: the box says no change is needed, and nothing is written. */
export const NoChangeNeeded: Story = {
  parameters: { msw: { handlers: answer({ changes: [], unmatched: [] }) } },
  play: async ({ canvasElement }) => {
    await ask(canvasElement, 'Make it with chicken')
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('status')).toHaveTextContent(
      'No ingredient change is needed for that.',
    )
    await expect(applied).toEqual([])
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
