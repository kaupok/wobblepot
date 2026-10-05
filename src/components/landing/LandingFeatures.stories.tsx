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
          "\"Made for family kitchens\" on the signed-out landing page: the heading, then one row per point with a static vignette built from the app's own components (the cook view's ingredients, the planner card, the household's member rows, a cooking step). From `md` their surfaces alternate: the salmon's yellow tint, the acai bowl's pink, the neutral card, the salmon again. Each vignette is `inert` with an `sr-only` caption; from `md` the vignette swaps sides on rows 2 and 4.",
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

  // The answer starts where the step text does, as in the cook view's panel.
  // Measured in layout coordinates: the vignette is tilted, and a tilt moves
  // the two bounding boxes apart although the text still lines up.
  const stepText = canvasElement.querySelector<HTMLElement>('[aria-pressed] p')
  const answer = canvas.getByText(/Press the thickest part/)
  const cook = canvas.getByTestId('landing-vignette-cook')
  const layoutLeft = (el: HTMLElement) => {
    let left = 0
    for (let node: Element | null = el; node instanceof HTMLElement && cook.contains(node);) {
      left += node.offsetLeft
      node = node.offsetParent
    }
    return left
  }
  await expect(stepText).not.toBeNull()
  await expect(layoutLeft(answer)).toBeCloseTo(layoutLeft(stepText!), 0)
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
