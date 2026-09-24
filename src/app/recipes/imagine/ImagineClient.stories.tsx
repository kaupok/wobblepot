import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse, delay } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { ImaginedMealResponse } from '@/lib/imagine-utils'
import { ImagineClient } from './ImagineClient'

const STORAGE_KEY = 'imagined-meals'

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
  // A resolved ingredient, so the review dialog's Save is reachable — it
  // refuses to save a meal with no components.
  ingredients: [
    {
      type: 'matched',
      extractedName: 'red lentils',
      extractedQuantity: 360,
      extractedUnit: 'g',
      originalText: '360 g red lentils',
      ingredient: {
        id: 'ing-lentil',
        name: 'Red lentils',
        category: 'protein',
        defaultUnit: 'g',
        gramsPerPiece: null,
      },
      convertedQuantity: 360,
      isVague: false,
    },
  ],
  allMatched: true,
})

const suggestions = [
  imaginedMeal('im-1', 'Smoky red lentil stew'),
  imaginedMeal('im-2', 'Charred pepper and lentil bowl'),
  imaginedMeal('im-3', 'Lentil ragù with orzo'),
]

const imagineSuccess = [
  http.post('/api/meals/imagine', () => HttpResponse.json({ success: true, meals: suggestions })),
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
 * The review round-trip: "Select" fine-tunes quantities, then the dialog's
 * "Save meal" posts the meal. Both are stubbed so `SavingOneKeepsTheStash` can
 * drive the flow end to end.
 */
const reviewAndSaveHandlers = [
  http.post('/api/meals/imagine/review', () =>
    HttpResponse.json({ success: true, ingredients: [] }),
  ),
  http.post('/api/households/me/meals', () => HttpResponse.json({ id: 'meal-saved' })),
]

/**
 * The server's review budget fired. A failed review costs the corrections, not
 * the meal: the dialog must still open, on the AI's original quantities, with
 * no error surfaced — the user never asked for the review by name (HON-699).
 */
const reviewTimeoutHandlers = [
  ...imagineSuccess,
  http.post('/api/meals/imagine/review', () =>
    HttpResponse.json(
      { error: 'Reviewing the quantities took too long. Please try again.' },
      { status: 504 },
    ),
  ),
]

/**
 * Records every hit on the generate endpoint so `RestoredFromSession` can prove
 * a restore costs no AI call — the whole point of HON-362.
 */
const imagineSpy = fn()
const imagineSpyHandlers = [
  http.post('/api/meals/imagine', () => {
    imagineSpy()
    return HttpResponse.json({ success: true, meals: suggestions })
  }),
]

const meta = {
  title: 'Feature/ImagineClient',
  component: ImagineClient,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The `/recipes/imagine` page client. Prompt + optional photos in, three AI suggestions out. A successful generation is stashed in `sessionStorage["imagined-meals"]` (see `imagine-session.ts`) so leaving for the create form and coming back restores the suggestions without a second AI call. `/api/meals/imagine` is served by per-story MSW handlers.',
      },
    },
  },
  // Nothing seeds the stash by default, and a played story would otherwise
  // leave one behind for whichever story mounts next.
  beforeEach: () => () => sessionStorage.removeItem(STORAGE_KEY),
} satisfies Meta<typeof ImagineClient>

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
        story: 'Request never resolves — three skeleton cards and the cancel button stay visible.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByRole('button', { name: /^cancel$/i })
  },
}

export const WithResults: Story = {
  parameters: {
    msw: { handlers: imagineSuccess },
    docs: {
      description: {
        story:
          'Three generated suggestions, each selectable for review. The generation is stashed on success.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))

    await canvas.findByText('Smoky red lentil stew')
    await canvas.findByText('Lentil ragù with orzo')

    // The page title is the only h1, on the page background, and each result
    // card's name sits one level below it (HON-779).
    expect(canvas.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(canvas.getByRole('heading', { level: 2, name: 'Smoky red lentil stew' })).toBeVisible()

    // The stash is what a later mount restores from.
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull())
  },
}

export const RestoredFromSession: Story = {
  parameters: {
    msw: { handlers: imagineSpyHandlers },
    docs: {
      description: {
        story:
          'The user pressed "Edit details", then Cancel on the create form. Mounting with a stash present restores the prompt and all three suggestions — and never calls `/api/meals/imagine`, which is the regression this story guards.',
      },
    },
  },
  // `play` runs after the component has mounted, so the stash has to exist
  // before render for the restore effect to see it.
  beforeEach: () => {
    imagineSpy.mockClear()
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        prompt: 'something with lentils',
        meals: suggestions,
        createdAt: Date.now(),
      }),
    )
    return () => sessionStorage.removeItem(STORAGE_KEY)
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await waitFor(() => expect(canvas.getByRole('textbox')).toHaveValue('something with lentils'))
    await canvas.findByText('Smoky red lentil stew')
    await canvas.findByText('Charred pepper and lentil bowl')
    await canvas.findByText('Lentil ragù with orzo')

    await expect(imagineSpy).not.toHaveBeenCalled()
  },
}

export const SavingOneKeepsTheStash: Story = {
  parameters: {
    msw: { handlers: reviewAndSaveHandlers },
    docs: {
      description: {
        story:
          'Saving a suggestion from the review dialog closes the dialog without navigating, so the other two stay on screen and selectable. The stash therefore has to survive the save — clearing it here would blank the page on the next mount, reopening the regression HON-362 closes.',
      },
    },
  },
  beforeEach: () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        prompt: 'something with lentils',
        meals: suggestions,
        createdAt: Date.now(),
      }),
    )
    return () => sessionStorage.removeItem(STORAGE_KEY)
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await canvas.findByText('Smoky red lentil stew')
    const [firstSelect] = canvas.getAllByRole('button', { name: /^select$/i })
    await userEvent.click(firstSelect!)

    // The dialog is portalled, so it lives outside `canvasElement`.
    const save = await body.findByRole('button', { name: /save meal/i })
    await userEvent.click(save)

    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())

    // All three cards are still rendered — and so is the stash behind them.
    await canvas.findByText('Charred pepper and lentil bowl')
    await canvas.findByText('Lentil ragù with orzo')
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull()
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
    // A failed run must not leave a stash behind for the next mount to restore.
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull())
  },
}

export const ReviewTimeoutStillOpensDialog: Story = {
  parameters: {
    msw: { handlers: reviewTimeoutHandlers },
    docs: {
      description: {
        story:
          'The review endpoint returns a 504. "Select" still opens the review dialog on the uncorrected meal, and nothing about the failure reaches the user — it is reported instead (HON-699).',
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

    // The dialog is portalled, so it lives outside `canvasElement`.
    await body.findByRole('dialog')
    await expect(canvas.queryByText(/too long/i)).not.toBeInTheDocument()
  },
}
