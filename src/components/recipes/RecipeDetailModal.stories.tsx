import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createMeal, lemonGarlicChickenComponentsFull } from '@/stories/fixtures'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import type { PreparationSteps } from '@/components/meal-plan/types'
import { RecipeDetailModal } from './RecipeDetailModal'

/** One of the household's own recipes, with its illustration and hue. */
const recipe = {
  ...createMeal({
    components: lemonGarlicChickenComponentsFull,
    description: 'Lemon-garlic roast chicken with crisp potatoes and a bright pan sauce.',
    timeMinutes: 45,
    kidFriendly: true,
    nutrition: { calories: 540, protein: 38, carbs: 41, fat: 22 },
  }),
  id: 'recipe-1',
  isCustom: true,
  imageStatus: 'ready' as const,
  imageUrl: mealIllustration.src,
  imageHue: 52,
}

const steps: PreparationSteps = {
  equipment: ['Sheet pan', 'Tongs'],
  steps: [
    'Heat the oven to 220°C.',
    'Season the chicken and set it on the potatoes.',
    'Roast for 35 minutes, then rest it for 5.',
  ],
  pitfalls: ['Don’t crowd the pan, or the potatoes steam.'],
  tip: 'Squeeze the roasted lemon over everything.',
}

/** Every servings count the view asked for, in order. */
const requested: number[] = []

const stepsHandler = http.post('/api/meals/:id/preparation-steps', async ({ request }) => {
  const body = (await request.json()) as { servings: number }
  requested.push(body.servings)
  return HttpResponse.json({ tips: steps })
})

const meta = {
  title: 'Recipes/RecipeDetailModal',
  component: RecipeDetailModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The cook view for one of the household’s own recipes, opened from My recipes (HON-1338). The planned view’s shell (`CookViewDialog`) and body (`MealDetail`), without what belongs to a plan entry: no note, no "Done cooking", no pantry ticks, no conflict badges, no ingredient changes and no Ask. It opens at the household’s servings; a change scales the ingredients and asks `POST /api/meals/{id}/preparation-steps` for steps at the new count, and nothing is saved. More actions holds Edit. Portal-based: queries go through `document.body`.',
      },
    },
    msw: { handlers: { steps: [stepsHandler] } },
  },
  args: {
    meal: recipe,
    householdServings: 2.5,
    open: true,
    onOpenChange: fn(),
  },
  beforeEach: () => {
    requested.length = 0
  },
} satisfies Meta<typeof RecipeDetailModal>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** The open dialog, once its enter animation has finished. */
async function findDialog(): Promise<HTMLElement> {
  const dialog = await body().findByRole('dialog')
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished))
  return dialog
}

/**
 * Opens at the household's 2.5 servings and loads the steps for them at once:
 * no "How to prepare", no note, no "Done cooking", no pantry checkboxes, no Ask.
 */
export const Default: Story = {
  play: async () => {
    const dialog = await findDialog()
    await expect(await within(dialog).findByText(steps.steps![0]!)).toBeVisible()
    await expect(within(dialog).getByRole('button', { name: /Serves 2\.5/ })).toBeVisible()
    await expect(requested).toEqual([2.5])
    await expect(within(dialog).queryByRole('button', { name: 'How to prepare' })).toBeNull()
    await expect(within(dialog).queryByRole('button', { name: /Done cooking/i })).toBeNull()
    await expect(within(dialog).queryByRole('checkbox')).toBeNull()
    await expect(within(dialog).queryByRole('button', { name: /^Ask/ })).toBeNull()
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async () => {
    const dialog = await findDialog()
    await expect(await within(dialog).findByText(steps.steps![0]!)).toBeVisible()
  },
}

/** More actions holds one item: Edit, a link to the recipe's edit page. */
export const MoreActionsEdit: Story = {
  play: async () => {
    const dialog = await findDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: /More actions/ }))
    const items = await body().findAllByRole('menuitem')
    await expect(items).toHaveLength(1)
    await expect(items[0]).toHaveAttribute('href', '/recipes/recipe-1/edit')
  },
}

/**
 * A serving change scales the amounts and, once the count settles, asks for
 * steps at the new count.
 */
export const ServingChange: Story = {
  play: async () => {
    const dialog = await findDialog()
    await within(dialog).findByText(steps.steps![0]!)
    await userEvent.click(within(dialog).getByRole('button', { name: /Serves 2\.5/ }))
    const field = within(dialog).getByRole('textbox', { name: 'Number of servings' })
    await userEvent.clear(field)
    await userEvent.type(field, '6{Enter}')
    await expect(within(dialog).getByRole('button', { name: /Serves 6/ })).toBeVisible()
    await waitFor(() => expect(requested).toEqual([2.5, 6]))
    await expect(await within(dialog).findByText(steps.steps![0]!)).toBeVisible()
  },
}

/** Skeletons while the steps are written. */
export const StepsLoading: Story = {
  parameters: {
    msw: {
      handlers: {
        steps: [
          http.post('/api/meals/:id/preparation-steps', async () => {
            await delay('infinite')
            return HttpResponse.json({ tips: steps })
          }),
        ],
      },
    },
  },
}

/** The household's hourly limit: catalog copy and Retry. */
export const StepsError: Story = {
  parameters: {
    msw: {
      handlers: {
        steps: [
          http.post('/api/meals/:id/preparation-steps', () =>
            HttpResponse.json(
              { error: 'Rate limit exceeded', code: 'rate_limited' },
              { status: 429 },
            ),
          ),
        ],
      },
    },
  },
  play: async () => {
    const dialog = await findDialog()
    await waitFor(() =>
      expect(within(dialog).getByText(/reached this hour's limit/i)).toBeVisible(),
    )
    await expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeVisible()
  },
}

/** Ticking a step marks it done on screen. */
export const TickStep: Story = {
  play: async () => {
    const dialog = await findDialog()
    const step = await within(dialog).findByRole('button', { name: new RegExp(steps.steps![0]!) })
    await userEvent.click(step)
    await expect(step).toHaveAttribute('aria-pressed', 'true')
  },
}

/** Without an illustration, on the plain background. */
export const WithoutImage: Story = {
  args: { meal: { ...recipe, imageStatus: 'none', imageUrl: null, imageHue: null } },
  parameters: {
    msw: {
      handlers: {
        image: [http.post('/api/meals/:id/image', () => HttpResponse.json({ status: 'none' }))],
      },
    },
  },
}
