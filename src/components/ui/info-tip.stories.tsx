import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { pressEscape } from '@/stories/a11y-helpers'
import { InfoTip } from './info-tip'

const LABEL = 'About these numbers'
const TEXT = 'Includes estimates for vague quantities like “to taste”.'

const meta = {
  title: 'UI/InfoTip',
  component: InfoTip,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An (i) button that explains the text beside it. A popover rather than a `Tooltip`, so a tap opens it on a phone; a mouse also opens it on hover and closes it on leave. Focus never moves into the content: Escape closes it and leaves focus on the button. `size="sm"` sits in a line of `text-xs` (the compact nutrition line), the default beside `text-sm` (HON-930).',
      },
    },
  },
  args: { label: LABEL, children: TEXT },
} satisfies Meta<typeof InfoTip>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Click opens it, Escape closes it, and focus is on the button throughout.
 * Hover-open needs a real mouse pointer, which a play function cannot
 * produce; `info-tip.test.tsx` covers it.
 */
export const Default: Story = {
  render: (args) => (
    <div className="flex items-center gap-1">
      <span className="text-sm font-medium">Nutrition (per serving)</span>
      <InfoTip {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    const trigger = within(canvasElement).getByRole('button', { name: LABEL })

    // The 16px box reaches 24px through its `::after` (WCAG 2.5.8).
    // The popover never takes focus, so a screen reader hears the text here.
    await expect(trigger).toHaveAccessibleDescription(TEXT)
    const after = window.getComputedStyle(trigger, '::after')
    await expect(trigger.getBoundingClientRect().height).toBe(16)
    await expect(after.top).toBe('-4px')
    await expect(after.left).toBe('-4px')

    // `aria-expanded`, not just the text: Presence keeps closing content
    // mounted through its exit animation, so the text alone can't prove open.
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const popover = await body.findByRole('dialog', { name: LABEL })
    await expect(within(popover).getByText(TEXT)).toBeInTheDocument()
    await expect(trigger).toHaveFocus()

    await pressEscape()
    await waitFor(() => expect(body.queryByRole('dialog')).not.toBeInTheDocument())
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toHaveFocus()
  },
}

export const Small: Story = {
  args: { size: 'sm' },
  render: (args) => (
    <div className="text-muted-foreground flex items-center gap-1 text-xs">
      <span>520 kcal · 42g protein · 30g carbs · 28g fat</span>
      <InfoTip {...args} />
    </div>
  ),
}

/** The open state, for reviewing the popover's surface in both themes. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: LABEL }))
    const popover = await within(document.body).findByRole('dialog', { name: LABEL })
    await expect(within(popover).getByText(TEXT)).toBeInTheDocument()
  },
}
