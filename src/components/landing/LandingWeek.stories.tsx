import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { LandingWeek } from './LandingWeek'

const meta = {
  title: 'Landing/LandingWeek',
  component: LandingWeek,
  tags: ['autodocs'],
  // The page's `px-4` gutter, which the strip's `-mx-4` pulls back to the
  // screen edges. Without it the strip itself reaches past the screen.
  decorators: [
    (Story) => (
      <div className="px-4 py-8">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Monday to Sunday under the landing page’s hero deck (HON-1116): the days before tonight cooked, muted, with a check; tonight in the foreground ink, naming the deck’s dinner; the rest to come. Seven columns from `md`. On a phone, a focusable strip that scrolls sideways, runs to the screen edges and opens with tonight centred.',
      },
    },
  },
  args: {
    locale: 'en',
    tonightIndex: 3,
    tonight: { name: 'Baked salmon with asparagus', minutes: 25 },
  },
} satisfies Meta<typeof LandingWeek>

export default meta
type Story = StoryObj<typeof meta>

const tonightCell = (canvasElement: HTMLElement) =>
  within(canvasElement)
    .getAllByRole('listitem')
    .find((day) => day.getAttribute('aria-current') === 'date')

/**
 * The page does not scroll sideways. A `sr-only` "Cooked" span that escapes
 * the strip widens the whole document (HON-1147).
 */
const expectNoPageOverflow = (canvasElement: HTMLElement) => {
  const root = canvasElement.ownerDocument.documentElement
  return expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
}

/** Phone (390 px): the strip scrolls, and opens with Thursday in view. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const strip = canvas.getByRole('region', { name: 'This week' })
    await expect(strip).toHaveAttribute('tabindex', '0')
    await expect(canvas.getAllByRole('listitem')).toHaveLength(7)
    await expect(canvas.getAllByText('Cooked')).toHaveLength(3)

    const tonight = tonightCell(canvasElement)
    await expect(tonight).toHaveTextContent('Thu · Tonight')
    await expect(tonight).toHaveTextContent('Baked salmon with asparagus')
    await expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth)
    await waitFor(() => {
      const box = tonight!.getBoundingClientRect()
      const view = strip.getBoundingClientRect()
      expect(box.left).toBeGreaterThanOrEqual(view.left)
      expect(box.right).toBeLessThanOrEqual(view.right)
    })
    await expectNoPageOverflow(canvasElement)
  },
}

/** Monday: tonight is the first day, and nothing is cooked yet. */
export const Monday: Story = {
  args: { tonightIndex: 0, tonight: { name: 'Chilli con carne', minutes: 45 } },
  play: async ({ canvasElement }) => {
    await expect(tonightCell(canvasElement)).toHaveTextContent('Mon · Tonight')
    await expect(within(canvasElement).queryByText('Cooked')).toBeNull()
  },
}

/**
 * Sunday: the rest of the week is cooked. Its "Cooked" text reaches farthest
 * along the strip, so this story catches the page overflow (HON-1147).
 */
export const Sunday: Story = {
  args: { tonightIndex: 6 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('Cooked')).toHaveLength(6)
    await expectNoPageOverflow(canvasElement)
  },
}

/** A demo dinner with no time: the minutes line is left out, not "null min". */
export const NoMinutes: Story = {
  args: { tonight: { name: 'Baked salmon with asparagus', minutes: null } },
  play: async ({ canvasElement }) => {
    await expect(tonightCell(canvasElement)).not.toHaveTextContent('min')
  },
}

export const Dark: Story = { globals: { theme: 'dark' } }

/** From `md`: seven columns, nothing to scroll. */
export const Desktop: Story = {
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const strip = within(canvasElement).getByRole('region', { name: 'This week' })
    await expect(strip.scrollWidth).toBeLessThanOrEqual(strip.clientWidth)
  },
}
