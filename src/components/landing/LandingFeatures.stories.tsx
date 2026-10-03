import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { LandingFeatures } from './LandingFeatures'

const meta = {
  title: 'Landing/LandingFeatures',
  component: LandingFeatures,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "\"Made for family kitchens\" on the signed-out landing page: the heading and trust line, then one row per point with a static vignette built from the app's own components (the cook view's ingredients, the planner card, the household's member rows, a cooking step). From `md` their surfaces alternate: the salmon's yellow tint, the acai bowl's pink, the neutral card, the salmon again. Each vignette is `inert` with an `sr-only` caption; from `md` the vignette swaps sides on rows 2 and 4.",
      },
    },
  },
} satisfies Meta<typeof LandingFeatures>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The four vignettes are present, Tab never lands inside one, and the page
 * does not scroll sideways at the story's width.
 */
const play: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await expect(canvas.getAllByRole('figure')).toHaveLength(4)
  // Pantry, recipes and cook are tinted; portions sits on the neutral card.
  await expect(canvasElement.querySelectorAll('[data-meal-surface]')).toHaveLength(3)
  await expect(
    canvas.getByTestId('landing-vignette-kids').querySelector('[data-meal-surface]'),
  ).toBeNull()

  const drawings = Array.from(canvasElement.querySelectorAll('[inert]'))
  await expect(drawings).toHaveLength(4)
  const focusable = drawings.flatMap((el) =>
    Array.from(el.querySelectorAll('button, input, [tabindex]')),
  )
  // Checkboxes, the link field, the recipe mark, the Serves pill, the step and its Ask button.
  await expect(focusable.length).toBeGreaterThan(0)
  ;(document.activeElement as HTMLElement | null)?.blur()
  for (let i = 0; i <= focusable.length; i++) {
    await userEvent.tab()
    await expect(document.activeElement?.closest('[inert]') ?? null).toBeNull()
  }

  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)

  // The answer starts where the step text does, as in the cook view's panel.
  const stepText = canvasElement.querySelector('[aria-pressed] p')
  const answer = canvas.getByText(/Press the thickest part/)
  await expect(stepText).not.toBeNull()
  await expect(answer.getBoundingClientRect().left).toBeCloseTo(
    stepText!.getBoundingClientRect().left,
    0,
  )
}

/** Phone (390 px): each row is the text, then its vignette. */
export const Default: Story = { play }

export const Dark: Story = {
  globals: { theme: 'dark' },
  play,
}

/** From `md`: two columns, the vignette on the right on rows 1 and 3, on the left on 2 and 4. */
export const Desktop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play,
}

export const DesktopDark: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false }, theme: 'dark' },
  play,
}
