import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { ImaginedMealResponse } from '@/lib/imagine-utils'
import { ImaginePanel } from './ImaginePanel'

const imaginedMeal = (id: string, name: string): ImaginedMealResponse => ({
  id,
  name,
  description: 'Generated from your prompt.',
  timeMinutes: 30,
  servings: 4,
  suitableFor: ['dinner'],
  kidFriendly: true,
  primaryProteinType: 'legume',
  components: [
    {
      ingredientId: 'ing-lentil',
      quantityPerServing: 90,
      ingredient: {
        id: 'ing-lentil',
        name: 'Red lentils',
        category: 'protein',
        defaultUnit: 'g',
      },
    },
  ],
  nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
  ingredients: [],
  allMatched: true,
})

const imagineSuccess = [
  http.post('/api/meals/imagine', () =>
    HttpResponse.json({
      success: true,
      meals: [
        imaginedMeal('im-1', 'Smoky red lentil stew'),
        imaginedMeal('im-2', 'Charred pepper and lentil bowl'),
        imaginedMeal('im-3', 'Lentil ragù with orzo'),
      ],
    }),
  ),
]

const imagineFailure = [
  http.post('/api/meals/imagine', () =>
    HttpResponse.json(
      // `error` is the route's English prose for logs; `code` is what the
      // client translates. The story asserts the translated string below, so
      // a regression that renders `error` again fails here (HON-700).
      {
        success: false,
        error: 'The kitchen is busy — try again',
        code: 'imagine_timeout',
      },
      { status: 504 },
    ),
  ),
]

const imaginePending = [
  http.post('/api/meals/imagine', async () => {
    await delay('infinite')
    return HttpResponse.json({ success: true, meals: [] })
  }),
]

/**
 * Selecting a meal posts it to the review endpoint before the save dialog
 * opens. `reviewSpy` proves the round-trip happened; the per-ingredient
 * arithmetic is covered by `imagine-utils.test.ts` rather than here.
 */
const reviewSpy = fn()
const reviewSuccess = [
  ...imagineSuccess,
  http.post('/api/meals/imagine/review', () => {
    reviewSpy()
    return HttpResponse.json({
      success: true,
      ingredients: [{ ingredientId: 'ing-lentil', quantityPerServing: 75 }],
    })
  }),
]

/**
 * The review budget fired server-side. A failed review costs the corrections,
 * not the meal — the dialog must still open and no error may surface (HON-699).
 */
const reviewTimeout = [
  ...imagineSuccess,
  http.post('/api/meals/imagine/review', () =>
    HttpResponse.json(
      { error: 'Reviewing the quantities took too long. Please try again.' },
      { status: 504 },
    ),
  ),
]

const meta = {
  title: 'Meal plan/ImaginePanel',
  component: ImaginePanel,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'AI "imagine a meal" flow extracted out of `MealSelectorModal`. Owns the prompt, attached photos, generate/cancel and the generated-meal results; the parent only supplies `onExit` and `onMealSaved`. `/api/meals/imagine` is served by per-story MSW handlers.',
      },
    },
  },
  args: {
    onExit: fn(),
    onMealSaved: fn(),
  },
} satisfies Meta<typeof ImaginePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Empty prompt — the generate button is disabled until text or a photo is added.',
      },
    },
  },
}

export const Generating: Story = {
  parameters: {
    msw: { handlers: imaginePending },
    docs: {
      description: {
        story: 'Request never resolves — skeleton results and the cancel button stay visible.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByRole('button', { name: /cancel/i })
  },
}

export const CancelStopsGenerating: Story = {
  parameters: {
    msw: { handlers: imaginePending },
    docs: {
      description: {
        story:
          'Cancel aborts the in-flight request and returns the panel to its idle state. This is the contract the `useMutation` conversion has to preserve: `reset()` has to clear `isPending` even though the aborted fetch settles later, and the resulting AbortError must not surface as an error message.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))

    await userEvent.click(await canvas.findByRole('button', { name: /cancel/i }))

    await waitFor(() =>
      expect(canvas.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument(),
    )
    // Back to the idle label, and the abort produced no error text.
    await canvas.findByRole('button', { name: /imagine meals/i })
    await expect(canvas.queryByText(/failed to generate/i)).not.toBeInTheDocument()
  },
}

export const WithResults: Story = {
  parameters: {
    msw: { handlers: imagineSuccess },
    docs: { description: { story: 'Three generated meals, each openable for review.' } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByText('Smoky red lentil stew')
  },
}

export const RequestFailed: Story = {
  parameters: {
    msw: { handlers: imagineFailure },
    docs: {
      description: {
        story:
          'The endpoint returns a coded 504 — the client renders its own translated copy, never the server prose.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByText('Generating meal ideas took too long. Please try again.')
    // The server's prose must not reach the screen.
    expect(canvas.queryByText('The kitchen is busy — try again')).not.toBeInTheDocument()
  },
}

export const ExitInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(args.onExit).toHaveBeenCalled())
  },
}

export const SelectReviewsThenOpensDialog: Story = {
  parameters: {
    msw: { handlers: reviewSuccess },
    docs: {
      description: {
        story:
          'Selecting a meal posts it to `/api/meals/imagine/review` first, then opens the save dialog on the reviewed meal.',
      },
    },
  },
  beforeEach: () => {
    reviewSpy.mockClear()
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByText('Smoky red lentil stew')

    const [firstSelect] = canvas.getAllByRole('button', { name: /^select$/i })
    await userEvent.click(firstSelect!)

    // The dialog is portalled, so it lives outside `canvasElement`.
    await body.findByRole('dialog')
    await waitFor(() => expect(reviewSpy).toHaveBeenCalled())
  },
}

export const SelectDegradesWhenReviewTimesOut: Story = {
  parameters: {
    msw: { handlers: reviewTimeout },
    docs: {
      description: {
        story:
          'The review endpoint returns a 504. The save dialog still opens and no error is surfaced — the user never asked for the review by name, so a failed one is a degradation rather than a blocker (HON-699).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByText('Smoky red lentil stew')

    const [firstSelect] = canvas.getAllByRole('button', { name: /^select$/i })
    await userEvent.click(firstSelect!)

    await body.findByRole('dialog')
    await expect(canvas.queryByText(/too long/i)).not.toBeInTheDocument()
  },
}
