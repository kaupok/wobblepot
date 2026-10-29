import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { displayFont } from './display-font'
import { LandingConnect } from './LandingConnect'

const meta = {
  title: 'Landing/LandingConnect',
  component: LandingConnect,
  tags: ['autodocs'],
  // `LandingConnect` renders an `<li>`; the landing page's root carries the
  // display face's variable.
  decorators: [
    (Story) => (
      <ul role="list" className={`${displayFont.variable} grid list-none md:grid-cols-2`}>
        <Story />
      </ul>
    ),
  ],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The fifth point of "Made for family kitchens", on a grey tile across both columns from `md`: the MCP server and the read-only API key. Two static vignettes: a chat where an assistant reads the meal plan and marks an item bought, and a kitchen screen with the next three dinners. Each vignette is `inert` with an `sr-only` caption.',
      },
    },
  },
} satisfies Meta<typeof LandingConnect>

export default meta
type Story = StoryObj<typeof meta>

/** Both vignettes are present and inert, and the page does not scroll sideways. */
const play: Story['play'] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await expect(canvas.getAllByRole('figure')).toHaveLength(2)
  await expect(canvasElement.querySelectorAll('[inert]')).toHaveLength(2)
  ;(document.activeElement as HTMLElement | null)?.blur()
  await userEvent.tab()
  await expect(document.activeElement?.closest('[inert]') ?? null).toBeNull()
  await expect(getComputedStyle(canvas.getByRole('heading', { level: 3 })).fontFamily).toMatch(
    /Bricolage Grotesque/,
  )
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
}

/** Phone (390 px): the text, then the chat, then the kitchen screen. */
export const Default: Story = { play }

export const Dark: Story = {
  globals: { theme: 'dark' },
  play,
}

/** From `md`: the tile spans both columns, with the two vignettes side by side. */
export const Desktop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play,
}
