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
      { success: false, error: 'The kitchen is busy — try again' },
      { status: 500 },
    ),
  ),
]

const imaginePending = [
  http.post('/api/meals/imagine', async () => {
    await delay('infinite')
    return HttpResponse.json({ success: true, meals: [] })
  }),
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
    docs: { description: { story: 'The endpoint returns a 500 — the error text is surfaced.' } },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByText('The kitchen is busy — try again')
  },
}

export const ExitInvokesCallback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(args.onExit).toHaveBeenCalled())
  },
}
