import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Card, CardContent } from '@/components/ui/card'

import { type PantryStock, PantryStockControl } from './PantryStockControl'

const meta = {
  title: 'Feature/Inventory/PantryStockControl',
  component: PantryStockControl,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "The pantry row's stock state as one control, Have it · Low · Ran out (HON-1624). A `ToggleGroup` with one pressed part: a screen reader reads the group with the item's name and the pressed part as checked. The pressed part carries a check, so the state does not rest on the fill alone. Have it, most rows' state, takes the quiet neutral fill; Low and Ran out take the warning tint, so the rows that need attention stand out (HON-1641). A press on the pressed part changes nothing. `PantrySection` maps each part to its request; the rows are in Feature/Inventory/PantrySection.",
      },
    },
  },
  args: {
    pantryItemId: 'pantry-1',
    name: 'Garlic',
    stock: 'haveIt',
    onStockChange: fn(),
  },
} satisfies Meta<typeof PantryStockControl>

export default meta
type Story = StoryObj<typeof meta>

const LABELS: Record<PantryStock, string> = { haveIt: 'Have it', low: 'Low', ranOut: 'Ran out' }

/**
 * The pressed part shows its tone's fill and the check: the neutral accent for
 * Have it, the warning tint for Low and Ran out, never the primary fill.
 */
async function expectPressedTone(scope: HTMLElement, stock: PantryStock) {
  const pressed = within(scope).getByRole('radio', { name: LABELS[stock] })
  await expect(pressed).toHaveAttribute('aria-checked', 'true')
  await expect(pressed).not.toHaveClass('data-[state=on]:bg-primary')
  if (stock === 'haveIt') {
    await expect(pressed).toHaveClass('data-[state=on]:bg-accent')
  } else {
    await expect(pressed).toHaveClass(
      'data-[state=on]:bg-warning-muted',
      'data-[state=on]:text-warning',
    )
  }
  const check = pressed.querySelector('[data-slot="toggle-indicator"]')
  if (!check) throw new Error('expected a check in the pressed part')
  await expect(getComputedStyle(check).display).not.toBe('none')
}

export const HaveIt: Story = {
  play: async ({ canvasElement, args }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Stock: Garlic' })
    const haveIt = within(group).getByRole('radio', { name: 'Have it' })
    await expect(haveIt).toHaveAttribute('aria-checked', 'true')
    await expect(within(group).getByRole('radio', { name: 'Low' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    // The pressed part keeps the state: a press on it changes nothing.
    await userEvent.click(haveIt)
    await expect(args.onStockChange).not.toHaveBeenCalled()
    await userEvent.click(within(group).getByRole('radio', { name: 'Ran out' }))
    await expect(args.onStockChange).toHaveBeenCalledWith('ranOut')
    await expectPressedTone(group, 'haveIt')
  },
}

export const Low: Story = {
  args: { stock: 'low' },
  play: async ({ canvasElement }) => expectPressedTone(canvasElement, 'low'),
}

/**
 * The `xs-touch` size (HON-1637): each part is 28px at 390px and at 1280px,
 * and its `::after` reaches 8px above and below it, so the target is 44px.
 */
export const CompactSize: Story = {
  args: { stock: 'low' },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Stock: Garlic' })
    for (const radio of within(group).getAllByRole('radio')) {
      await expect(radio.getBoundingClientRect().height).toBe(28)
      const target = getComputedStyle(radio, '::after')
      await expect(target.top).toBe('-8px')
      await expect(target.bottom).toBe('-8px')
    }
  },
}

export const CompactSizeDesktop: Story = {
  ...CompactSize,
  globals: { viewport: { value: 'desktop', isRotated: false } },
}

export const RanOut: Story = {
  args: { stock: 'ranOut' },
  play: async ({ canvasElement }) => expectPressedTone(canvasElement, 'ranOut'),
}

/**
 * The three states on the yellow note sheet (the stock control's check rows on
 * `/shopping`), so the a11y run measures each pressed part there. On the note
 * `--accent` is the tint's chip, a stronger yellow than the warning fill, so a
 * pressed Have it keeps the sheet's colour and only its check marks it
 * (globals.css); a pressed Low or Ran out keeps its warning fill.
 */
export const OnNote: Story = {
  render: (args) => (
    <Card data-surface="note">
      <CardContent className="flex flex-col gap-3">
        {(['haveIt', 'low', 'ranOut'] as const).map((stock) => (
          <div key={stock} data-testid={stock}>
            <PantryStockControl {...args} pantryItemId={stock} stock={stock} />
          </div>
        ))}
      </CardContent>
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const stock of ['haveIt', 'low', 'ranOut'] as const) {
      await expectPressedTone(canvas.getByTestId(stock), stock)
    }
    const sheet = getComputedStyle(canvasElement.querySelector('[data-surface="note"]')!)
    const pressedFill = (stock: PantryStock) =>
      getComputedStyle(
        within(canvas.getByTestId(stock)).getByRole('radio', { name: LABELS[stock] }),
      ).backgroundColor
    await expect(pressedFill('haveIt')).toBe(sheet.backgroundColor)
    await expect(pressedFill('low')).not.toBe(sheet.backgroundColor)
    await expect(pressedFill('ranOut')).not.toBe(sheet.backgroundColor)
  },
}

export const OnNoteDark: Story = {
  ...OnNote,
  globals: { theme: 'dark' },
}

export const EstonianPhone: Story = {
  args: { stock: 'low', name: 'konserveeritud kooritud terved tomatid' },
  globals: { locale: 'et', viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('radiogroup', {
      name: 'Varu: konserveeritud kooritud terved tomatid',
    })
    await expect(within(group).getByRole('radio', { name: 'Vähe' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    // One line: every part shares a top.
    const tops = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getBoundingClientRect().top)
    await expect(new Set(tops).size).toBe(1)
  },
}
