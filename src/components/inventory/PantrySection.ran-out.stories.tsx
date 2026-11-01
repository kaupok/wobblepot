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

const meta = {
  title: 'Feature/Inventory/PantrySection/Ran out',
  component: PantrySection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The switch on each pantry row (HON-1535) and the Ran out group (HON-1288). Every row has a switch: on while the household has it, off at 0, with the state word ("Have it" or "Ran out") beside it. Switch-off sets the row to 0, and an ordinary row moves to Ran out; a staple stays under Staples. Switch-on sends back the quantity the row had. Focus follows the row\'s switch, so a second press undoes a slip. The other states are in Feature/Inventory/PantrySection.',
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
          'Two rows at quantity 0 under "Ran out", after "On hand", each with its switch off and the word "Ran out". Switch-on moves the row back to On hand, and focus follows its switch there, so focus never falls to the page and a second press undoes a slip.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 2' })).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 3, name: 'On hand 3' })).toBeInTheDocument()
    await expect(canvas.getByRole('switch', { name: 'Have it: Avocado' })).not.toBeChecked()

    await userEvent.click(canvas.getByRole('switch', { name: 'Have it: Avocado' }))

    await waitFor(() =>
      expect(canvas.getByRole('heading', { level: 3, name: 'On hand 4' })).toBeInTheDocument(),
    )
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    await expect(canvas.getByRole('switch', { name: 'Have it: Avocado' })).toBeChecked()
    await expect(canvas.getByRole('switch', { name: 'Have it: Avocado' })).toHaveFocus()
  },
}

export const RanOutEstonian: Story = {
  args: { items: [...staples, ...onHand, ...ranOut] },
  globals: { locale: 'et', viewport: { value: 'mobileIphone', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'The Ran out group in Estonian on a phone: "Otsas" over the rows and beside each switch that is off, "Olemas" beside each switch that is on. The word has a fixed width, so the switch sits in one column on every row and does not wrap.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 3, name: 'Otsas 2' })).toBeInTheDocument()
    const off = canvas.getByRole('switch', { name: 'Olemas: Avocado' })
    const on = canvas.getByRole('switch', { name: 'Olemas: Garlic' })
    await expect(off).not.toBeChecked()
    await expect(on).toBeChecked()
    const row = (name: string) => canvas.getByText(name).closest('.p-3') as HTMLElement
    await expect(within(row('Avocado')).getByText('Otsas')).toBeVisible()
    await expect(within(row('Garlic')).getByText('Olemas')).toBeVisible()
    // One column: a flip that changes the word does not move the switch.
    await expect(off.getBoundingClientRect().left).toBe(on.getBoundingClientRect().left)
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
          'A staple at 0 stays under Staples, with its switch off and "Ran out" once, beside the switch. Switch-on sets it back to "have some" and keeps focus on the switch, so a second press undoes a slip. The switch track is 18px, and its `::after` reaches 14px above and below the 16px inside its border, so the target is 44px on a phone while the row keeps its height.',
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
    const row = canvas.getByText('Eggs').closest('.p-3') as HTMLElement
    await expect(within(row).getAllByText('Ran out')).toHaveLength(1)
    const control = canvas.getByRole('switch', { name: 'Have it: Eggs' })
    await expect(control).not.toBeChecked()
    await expect(Math.round(control.getBoundingClientRect().height)).toBe(18)
    // Word, switch and Remove fit the 123.9px that the old "Ran out" button
    // (83.9px at the phone's 16px label), its gap and Remove took, so the name
    // keeps its width at 390px. Geist must be in, or the word measures narrow.
    await document.fonts.ready
    const word = row.querySelector('[data-state-word]') as HTMLElement
    const remove = within(row).getByRole('button', { name: 'Remove Eggs' })
    await expect(
      remove.getBoundingClientRect().right - word.getBoundingClientRect().left,
    ).toBeLessThanOrEqual(123.9)
    const after = getComputedStyle(control, '::after')
    await expect(after.position).toBe('absolute')
    await expect(after.top).toBe('-14px')
    await expect(after.bottom).toBe('-14px')

    await userEvent.click(control)

    await waitFor(() => expect(control).toBeChecked())
    await expect(control).toHaveFocus()
    await expect(within(row).getByText('Have it')).toBeVisible()
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(1))
  },
}

export const MarkRanOut: Story = {
  parameters: {
    msw: { handlers: [patchHandler] },
    docs: {
      description: {
        story:
          'Switch-off on an On hand row moves it to the Ran out group and focus follows its switch there. On a staple it keeps the row under Staples.',
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    for (const control of canvas.getAllByRole('switch')) await expect(control).toBeChecked()

    await userEvent.click(canvas.getByRole('switch', { name: 'Have it: Garlic' }))

    await waitFor(() =>
      expect(canvas.getByRole('switch', { name: 'Have it: Garlic' })).toHaveFocus(),
    )
    await expect(canvas.getByRole('switch', { name: 'Have it: Garlic' })).not.toBeChecked()
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 3, name: 'On hand 2' })).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('switch', { name: 'Have it: Salt' }))

    await waitFor(() =>
      expect(canvas.getByRole('switch', { name: 'Have it: Salt' })).not.toBeChecked(),
    )
    await expect(canvas.getByRole('switch', { name: 'Have it: Salt' })).toHaveFocus()
    await expect(canvas.getByRole('heading', { level: 3, name: 'Ran out 1' })).toBeInTheDocument()
    await waitFor(() => expect(args.onPantryQuantityChanged).toHaveBeenCalledTimes(2))
  },
}

/** Answers the Undo's POST with the posted row, named from the story's items. */
// One On hand row holds an amount, the rest are "have some" (HON-1402).
