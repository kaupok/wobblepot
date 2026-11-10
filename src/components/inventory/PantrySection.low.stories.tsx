import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { createPantryItemData } from '@/stories/fixtures'

import { PantrySection } from './PantrySection'
import {
  ingredient,
  onHand,
  patchHandler,
  ranOut,
  staples,
  StatefulPantrySection,
} from './PantrySection.story.fixtures'

type Canvas = ReturnType<typeof within>

/** A part of the row's stock control, found through the group's name. */
const part = (canvas: Canvas, group: string, name: string) =>
  within(canvas.getByRole('radiogroup', { name: group })).getByRole('radio', { name })

const meta = {
  title: 'Feature/Inventory/PantrySection/Running low',
  component: PantrySection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    msw: { handlers: [patchHandler] },
    docs: {
      description: {
        component:
          'The Low part of each pantry row\'s stock control, Have it · Low · Ran out (HON-1624, HON-1587). It sits on its own line under the name; the amount button sits on the right, before Remove. Pressed, it shows a check on the warning fill and the row goes on the shopping list as a line with no amount (HON-1586). A low row stays in its group. Low on a row in Ran out sets it to "have some" and low in one request, and the row moves back to On hand. The other states are in Feature/Inventory/PantrySection.',
      },
    },
  },
  args: {
    items: [...staples, ...onHand],
    onItemsChange: fn(),
    onPantryQuantityChanged: fn(),
    onPantryItemRemoved: fn(),
    onPantryItemRestored: fn(),
  },
  render: (args) => <StatefulPantrySection {...args} />,
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PantrySection>

export default meta
type Story = StoryObj<typeof meta>

const lowStaple = createPantryItemData({
  ingredient: ingredient('sunflower-oil', 'Sunflower oil', 'fat'),
  isStaple: true,
  low: true,
})
const lowOnHand = createPantryItemData({
  ingredient: ingredient('onion', 'Onion', 'vegetable', 'piece'),
  low: true,
})

export const LowStapleAndOnHand: Story = {
  args: { items: [lowStaple, ...staples, lowOnHand, ...onHand, ...ranOut] },
  parameters: {
    docs: {
      description: {
        story:
          'A low staple and a low On hand row, each with Low pressed and its check showing. Each stays in its group. The Ran out rows have Ran out pressed.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(part(canvas, 'Stock: Sunflower oil', 'Low')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(part(canvas, 'Stock: Onion', 'Low')).toHaveAttribute('aria-checked', 'true')
    await expect(part(canvas, 'Stock: Salt', 'Have it')).toHaveAttribute('aria-checked', 'true')
    await expect(part(canvas, 'Stock: Salt', 'Low')).toHaveAttribute('aria-checked', 'false')
    await expect(part(canvas, 'Stock: Avocado', 'Ran out')).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('heading', { level: 3, name: 'On hand 4' })).toBeInTheDocument()
    // The normal state stays quiet and the rows that need attention stand out
    // (HON-1641): a pressed Have it takes the neutral fill, a pressed Low or
    // Ran out the warning one, and none the primary fill.
    const haveIt = getComputedStyle(part(canvas, 'Stock: Salt', 'Have it'))
    const low = getComputedStyle(part(canvas, 'Stock: Onion', 'Low'))
    const ranOutPart = getComputedStyle(part(canvas, 'Stock: Avocado', 'Ran out'))
    await expect(low.backgroundColor).not.toBe(haveIt.backgroundColor)
    await expect(ranOutPart.backgroundColor).toBe(low.backgroundColor)
    await expect(ranOutPart.color).toBe(low.color)
    await expect(low.color).not.toBe(haveIt.color)
  },
}

// A staple, so the right side holds only Remove. Beside "Lisa kogus" on an
// On hand row the name has about 140px at 390px and wraps on three lines.
const tomatoes = createPantryItemData({
  ingredient: ingredient('tomatoes', 'konserveeritud kooritud terved tomatid', 'vegetable'),
  isStaple: true,
})

export const LowEstonianPhone: Story = {
  args: { items: [lowStaple, ...staples, lowOnHand, tomatoes, ...onHand] },
  globals: { locale: 'et', viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Estonian on a phone: Olemas · Vähe · Otsas on one line under the name, and "Lisa kogus" on the right, before Remove. A long name on a row with only Remove on the right (a staple, a Ran out row) wraps on at most two lines. Each part is a 28px `xs-touch` box whose `::after` reaches 8px above and below it, so the target is 44px.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const low = part(canvas, 'Varu: Onion', 'Vähe')
    await expect(low).toHaveAttribute('aria-checked', 'true')
    await expect(low.getBoundingClientRect().height).toBe(28)
    const target = getComputedStyle(low, '::after')
    await expect(target.top).toBe('-8px')
    await expect(target.bottom).toBe('-8px')
    const group = canvas.getByRole('radiogroup', { name: 'Varu: Onion' })
    const tops = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getBoundingClientRect().top)
    await expect(new Set(tops).size).toBe(1)
    // The amount button sits on the right, beside Remove, above the control.
    const amount = canvas.getByRole('button', { name: 'Lisa kogus: Onion' }).getBoundingClientRect()
    const remove = canvas.getByRole('button', { name: 'Eemalda „Onion"' }).getBoundingClientRect()
    await expect(amount.right).toBeLessThanOrEqual(remove.left)
    await expect(amount.top).toBe(remove.top)
    await expect(amount.bottom).toBeLessThan(group.getBoundingClientRect().top)

    // A long name beside Remove alone wraps on at most two of its 28px
    // lines, and its control still fits one line. Geist must be in, or the
    // name measures narrow.
    await document.fonts.ready
    const longName = canvas.getByText('konserveeritud kooritud terved tomatid')
    await expect(longName.getBoundingClientRect().height).toBeLessThanOrEqual(56)
    const longTops = within(
      canvas.getByRole('radiogroup', { name: 'Varu: konserveeritud kooritud terved tomatid' }),
    )
      .getAllByRole('radio')
      .map((radio) => radio.getBoundingClientRect().top)
    await expect(new Set(longTops).size).toBe(1)
  },
}

export const LowKeepsFocus: Story = {
  args: { items: [...staples, ...onHand] },
  parameters: {
    docs: {
      description: {
        story:
          'A tap on Low sends `{ low: true }`; a tap on Have it clears it. The row stays in its group, so focus stays on the pressed part after the response.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const low = part(canvas, 'Stock: Garlic', 'Low')
    await userEvent.click(low)
    await expect(low).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(1))
    await expect(low).toHaveFocus()
    const haveIt = part(canvas, 'Stock: Garlic', 'Have it')
    await userEvent.click(haveIt)
    await expect(haveIt).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(2))
    await expect(haveIt).toHaveFocus()
  },
}

export const LowFromRanOut: Story = {
  args: { items: [...staples, ...onHand, ...ranOut] },
  parameters: {
    docs: {
      description: {
        story:
          'Low on a row in Ran out sends one `{ low: true }`, which also sets it to "have some". The row moves back to On hand and focus follows it to its pressed Low.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 2' })).toBeInTheDocument()
    await userEvent.click(part(canvas, 'Stock: Avocado', 'Low'))
    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 3, name: 'On hand 4' })).toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    const low = part(canvas, 'Stock: Avocado', 'Low')
    await expect(low).toHaveAttribute('aria-checked', 'true')
    await expect(low).toHaveFocus()
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(1))
  },
}
