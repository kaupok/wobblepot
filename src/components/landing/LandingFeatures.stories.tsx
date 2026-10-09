import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { displayFont } from './display-font'
import { LandingFeatures } from './LandingFeatures'

const meta = {
  title: 'Landing/LandingFeatures',
  component: LandingFeatures,
  tags: ['autodocs'],
  // In the app the landing page's root carries the display face's variable.
  decorators: [
    (Story) => (
      <div className={displayFont.variable}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "\"Made for family kitchens\" on the signed-out landing page: the heading, then the four points as tiles, two columns from `md`, each with a static vignette built from the app's own components (the cook view's ingredients, the imagine prompt and the planner card, the household's member rows, a cooking step with a question and its answer). From `md` their surfaces alternate: the salmon's yellow tint, the butter chicken's orange, the neutral card, the salmon again. Each vignette is `inert` with an `sr-only` caption.",
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
  // Pantry, imagine and cook are tinted; portions sits on the neutral card.
  await expect(canvasElement.querySelectorAll('[data-meal-surface]')).toHaveLength(3)
  await expect(
    canvas.getByTestId('landing-vignette-kids').querySelector('[data-meal-surface]'),
  ).toBeNull()

  const drawings = Array.from(canvasElement.querySelectorAll('[inert]'))
  await expect(drawings).toHaveLength(4)
  const focusable = drawings.flatMap((el) =>
    Array.from(el.querySelectorAll('button, input, [tabindex]')),
  )
  // Checkboxes, the prompt field and the Imagine button, the recipe mark and
  // the Serves pill.
  await expect(focusable.length).toBeGreaterThan(0)
  ;(document.activeElement as HTMLElement | null)?.blur()
  for (let i = 0; i <= focusable.length; i++) {
    await userEvent.tab()
    await expect(document.activeElement?.closest('[inert]') ?? null).toBeNull()
  }

  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)

  // The section heading and point titles are in the display face; the
  // vignettes, drawn with the app's components, keep Geist (HON-1043).
  const family = (el: Element) => getComputedStyle(el).fontFamily
  await expect(family(canvas.getByRole('heading', { level: 2 }))).toMatch(/Bricolage Grotesque/)
  await expect(
    family(canvas.getByRole('heading', { level: 3, name: 'It knows your pantry' })),
  ).toMatch(/Bricolage Grotesque/)
  for (const el of drawings) {
    await expect(el.querySelector('.font-display')).toBeNull()
    await expect(family(el)).not.toMatch(/Bricolage Grotesque/)
  }
}

/** Phone (390 px): one column of tiles. */
export const Default: Story = { play }

export const Dark: Story = {
  globals: { theme: 'dark' },
  play,
}

/** From `md`: two columns of tiles. */
export const Desktop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play,
}

export const DesktopDark: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false }, theme: 'dark' },
  play,
}
