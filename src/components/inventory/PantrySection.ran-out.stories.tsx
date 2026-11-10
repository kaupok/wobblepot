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
  title: 'Feature/Inventory/PantrySection/Ran out',
  component: PantrySection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The stock control on each pantry row, Have it · Low · Ran out (HON-1624), and the Ran out group (HON-1288). Ran out sets the row to 0, and an ordinary row moves to Ran out; a staple stays under Staples. Have it from Ran out sends back the quantity the row had. Focus follows the row's control to the pressed part, so a second press undoes a slip. Low is in Feature/Inventory/PantrySection/Running low; the other states are in Feature/Inventory/PantrySection.",
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

export const RanOut: Story = {
  args: { items: [...staples, ...onHand, ...ranOut] },
  parameters: {
    docs: {
      description: {
        story:
          'Two rows at quantity 0 under "Ran out", after "On hand", each with Ran out pressed. Have it moves the row back to On hand, and focus follows the row to its pressed Have it there, so focus never falls to the page and a second press undoes a slip.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 2' })).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 3, name: 'On hand 3' })).toBeInTheDocument()
    await expect(part(canvas, 'Stock: Avocado', 'Ran out')).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(part(canvas, 'Stock: Avocado', 'Have it'))

    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 3, name: 'On hand 4' })).toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    const haveIt = part(canvas, 'Stock: Avocado', 'Have it')
    await expect(haveIt).toHaveAttribute('aria-checked', 'true')
    await expect(haveIt).toHaveFocus()
  },
}

export const RanOutEstonian: Story = {
  args: { items: [...staples, ...onHand, ...ranOut] },
  globals: { locale: 'et', viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'The Ran out group in Estonian on a phone: "Otsas" over the rows, and Olemas · Vähe · Otsas on each row with Otsas pressed. The control starts at the same place on every row and fits one line.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Otsas 2' })).toBeInTheDocument()
    const off = part(canvas, 'Varu: Avocado', 'Otsas')
    const on = part(canvas, 'Varu: Garlic', 'Olemas')
    await expect(off).toHaveAttribute('aria-checked', 'true')
    await expect(on).toHaveAttribute('aria-checked', 'true')
    // One line: every part of the group shares a top.
    const tops = within(canvas.getByRole('radiogroup', { name: 'Varu: Avocado' }))
      .getAllByRole('radio')
      .map((radio) => radio.getBoundingClientRect().top)
    await expect(new Set(tops).size).toBe(1)
    await expect(
      canvas.getByRole('radiogroup', { name: 'Varu: Avocado' }).getBoundingClientRect().left,
    ).toBe(canvas.getByRole('radiogroup', { name: 'Varu: Garlic' }).getBoundingClientRect().left)
  },
}

export const StapleRanOut: Story = {
  args: {
    items: [
      createPantryItemData({
        ingredient: ingredient('eggs', 'Eggs', 'protein', 'piece'),
        isStaple: true,
        quantity: 0,
      }),
      ...staples,
      ...onHand,
    ],
  },
  parameters: {
    msw: { handlers: [patchHandler] },
    docs: {
      description: {
        story:
          'A staple at 0 stays under Staples, with Ran out pressed. Have it sets it back to "have some" and focus moves to the pressed Have it, so a second press undoes a slip. Each part is a 32px box whose `::after` reaches 6px above and below it, so the target is 44px on a phone.',
      },
    },
  },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { level: 3, name: /^Staples.* 3$/ }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('heading', { name: /^Ran out/ })).not.toBeInTheDocument()
    await expect(part(canvas, 'Stock: Eggs', 'Ran out')).toHaveAttribute('aria-checked', 'true')
    const haveIt = part(canvas, 'Stock: Eggs', 'Have it')
    await expect(Math.round(haveIt.getBoundingClientRect().height)).toBe(32)
    // English on a phone: the three parts fit one line.
    const tops = within(canvas.getByRole('radiogroup', { name: 'Stock: Eggs' }))
      .getAllByRole('radio')
      .map((radio) => radio.getBoundingClientRect().top)
    await expect(new Set(tops).size).toBe(1)
    const after = getComputedStyle(haveIt, '::after')
    await expect(after.position).toBe('absolute')
    await expect(after.top).toBe('-6px')
    await expect(after.bottom).toBe('-6px')

    await userEvent.click(haveIt)

    await waitFor(() => expect(haveIt).toHaveAttribute('aria-checked', 'true'))
    await expect(haveIt).toHaveFocus()
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(1))
  },
}

export const MarkRanOut: Story = {
  parameters: {
    msw: { handlers: [patchHandler] },
    docs: {
      description: {
        story:
          'Ran out on an On hand row moves it to the Ran out group, and focus follows the row to its pressed Ran out there. On a staple it keeps the row under Staples.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    for (const group of canvas.getAllByRole('radiogroup', { name: /^Stock: / })) {
      await expect(within(group).getByRole('radio', { name: 'Have it' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    }

    await userEvent.click(part(canvas, 'Stock: Garlic', 'Ran out'))

    await waitFor(() => expect(part(canvas, 'Stock: Garlic', 'Ran out')).toHaveFocus())
    await expect(part(canvas, 'Stock: Garlic', 'Ran out')).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 3, name: 'On hand 2' })).toBeInTheDocument()

    await userEvent.click(part(canvas, 'Stock: Salt', 'Ran out'))

    await waitFor(() =>
      expect(part(canvas, 'Stock: Salt', 'Ran out')).toHaveAttribute('aria-checked', 'true'),
    )
    await expect(part(canvas, 'Stock: Salt', 'Ran out')).toHaveFocus()
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(2))
  },
}

/** Answers the Undo's POST with the posted row, named from the story's items. */
// One On hand row holds an amount, the rest are "have some" (HON-1402).
