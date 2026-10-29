import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
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
        // 90 g per serving → 315 kcal, unlike the model's 480 estimate, so a
        // story sees the card take the dialog's numbers (HON-1367).
        calories: 350,
        protein: 24,
        carbs: 60,
        fat: 1.5,
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
 * The review round-trip: "Review and save" fine-tunes quantities, then the dialog's
 * "Save recipe" posts the recipe. Both are stubbed so `SavingOneKeepsTheStash` can
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
        story:
          'Request never resolves — three skeleton cards and the cancel button stay visible. The pressed button and the prompt field are `aria-disabled`, not `disabled`, so focus stays on the button, and each card announces "Loading…" once (HON-1366).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByRole('button', { name: /^cancel$/i })

    const button = canvas.getByRole('button', { name: /generating ideas/i })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(button).toBeEnabled()
    await expect(button).toHaveFocus()
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-disabled', 'true')
    await expect(canvas.getByRole('textbox')).toBeEnabled()
    await expect(canvas.getAllByRole('status', { name: 'Loading…' })).toHaveLength(3)
  },
}

export const CancelWhileGenerating: Story = {
  parameters: {
    msw: { handlers: imaginePending },
    docs: {
      description: {
        story:
          'Cancel pressed while ideas load — the run stops and Cancel unmounts, so focus moves to the prompt field, not to the page (HON-1373).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const prompt = canvas.getByRole('textbox')
    await userEvent.type(prompt, 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await userEvent.click(await canvas.findByRole('button', { name: /^cancel$/i }))

    await expect(canvas.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument()
    await expect(prompt).toHaveFocus()
    await expect(prompt).not.toHaveAttribute('aria-disabled')
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

    // A screen reader hears the result; focus stays on the button (HON-1366).
    await expect(canvas.getByRole('status')).toHaveTextContent('3 meal ideas ready')
    const again = canvas.getByRole('button', { name: /imagine again/i })
    await expect(again).toHaveFocus()

    // One filled button at a time: with ideas showing, it is none of these
    // (HON-1367). The review dialog's Save is the filled one.
    await expect(again).toHaveAttribute('data-variant', 'outline')
    for (const button of canvas.getAllByRole('button', { name: /^review and save$/i })) {
      await expect(button).toHaveAttribute('data-variant', 'outline')
    }

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
    // Taken before the dialog opens: the modal hides the page from role queries.
    const firstCard = canvas
      .getByRole('heading', { name: 'Smoky red lentil stew' })
      .closest<HTMLElement>('[data-slot="card"]')!
    const [firstSelect] = canvas.getAllByRole('button', { name: /^review and save$/i })
    await userEvent.click(firstSelect!)

    // The dialog is portalled, so it lives outside `canvasElement`.
    const save = await body.findByRole('button', { name: /save recipe/i })
    // The card now shows the dialog's numbers, not the model's estimate (HON-1367).
    // The dialog fades in, so its text is not visible on first render.
    const dialog = body.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('315 kcal')).toBeVisible())
    await expect(within(firstCard).getByText('315 kcal')).toBeInTheDocument()
    await expect(within(canvasElement).getAllByText('480 kcal')).toHaveLength(2)
    await userEvent.click(save)

    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())

    // All three cards are still rendered — and so is the stash behind them.
    await canvas.findByText('Charred pepper and lentil bowl')
    await canvas.findByText('Lentil ragù with orzo')
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull()

    // The saved idea links its recipe in place of "Review and save", and focus lands on
    // that link rather than falling to <body> (HON-1270).
    const openRecipe = await canvas.findByRole('link', { name: 'Open recipe' })
    expect(openRecipe).toHaveAttribute('href', '/recipes/meal-saved/edit')
    await waitFor(() => expect(openRecipe).toHaveFocus())
    expect(canvas.getAllByRole('button', { name: /^review and save$/i })).toHaveLength(2)
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!).savedMealIds).toEqual({
      'im-1': 'meal-saved',
    })
  },
}

export const OneIdeaSaved: Story = {
  parameters: {
    msw: { handlers: imagineSpyHandlers },
    docs: {
      description: {
        story:
          'The user saved the second idea earlier in this tab. Its card shows "Saved" and an "Open recipe" link to the recipe in place of "Review and save", so the same idea cannot be saved twice; the other two stay selectable (HON-1270).',
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
        savedMealIds: { 'im-2': 'meal-saved' },
      }),
    )
    return () => sessionStorage.removeItem(STORAGE_KEY)
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await canvas.findByText('Saved')
    expect(canvas.getByRole('link', { name: 'Open recipe' })).toHaveAttribute(
      'href',
      '/recipes/meal-saved/edit',
    )
    expect(canvas.getAllByRole('button', { name: /^review and save$/i })).toHaveLength(2)
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
          'The review endpoint returns a 504. "Review and save" still opens the review dialog on the uncorrected meal, and nothing about the failure reaches the user — it is reported instead (HON-699).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.type(canvas.getByRole('textbox'), 'something with lentils')
    await userEvent.click(canvas.getByRole('button', { name: /imagine meals/i }))
    await canvas.findByText('Smoky red lentil stew')

    const [firstSelect] = canvas.getAllByRole('button', { name: /^review and save$/i })
    await userEvent.click(firstSelect!)

    // The dialog is portalled, so it lives outside `canvasElement`. It takes
    // focus from the pressed "Review and save" (HON-1366).
    const dialog = await body.findByRole('dialog')
    await waitFor(() => expect(dialog).toHaveFocus())
    await expect(canvas.queryByText(/too long/i)).not.toBeInTheDocument()
  },
}

export const Desktop: Story = {
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop width. "Imagine meals" is as wide as its label and starts at the column edge; on a phone it fills the column (HON-782). The column fills the page width, as a list does, so the prompt and the results grid are not boxed in (HON-1367).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: /imagine meals/i })
    await expect(button.getBoundingClientRect().width).toBeLessThan(
      button.parentElement!.getBoundingClientRect().width,
    )
    // The prompt spans the page container's content box: no `max-w-*` column.
    const prompt = within(canvasElement).getByRole('textbox')
    const page = canvasElement.querySelector<HTMLElement>('.px-4')!
    const { paddingLeft, paddingRight } = getComputedStyle(page)
    const contentWidth =
      page.getBoundingClientRect().width - parseFloat(paddingLeft) - parseFloat(paddingRight)
    await expect(
      prompt.closest<HTMLElement>('.flex.flex-col.gap-6')!.getBoundingClientRect().width,
    ).toBeCloseTo(contentWidth, 0)
  },
}
