import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { pressEscape } from '@/stories/a11y-helpers'
import { TimelinePastMenu } from './TimelinePastMenu'

const meta = {
  title: 'Feature/Timeline/TimelinePastMenu',
  component: TimelinePastMenu,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    expanded: false,
    catchUpCount: 0,
    onToggle: fn(),
  },
} satisfies Meta<typeof TimelinePastMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Collapsed: Story = {}

export const CollapsedWithCatchUp: Story = {
  args: { catchUpCount: 2 },
  parameters: {
    docs: {
      description: {
        story:
          'Past meals still need marking: a warning dot sits on the trigger and the count moves into the trigger name and the menu item.',
      },
    },
  },
}

export const Expanded: Story = {
  args: { expanded: true },
}

export const ExpandedWithCatchUp: Story = {
  args: { expanded: true, catchUpCount: 2 },
}

export const SelectAndEscape: Story = {
  args: { catchUpCount: 2 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const trigger = canvas.getByRole('button', {
      name: 'Timeline options, 2 past meals to catch up',
    })

    // Selecting the item fires the toggle and closes the menu.
    await userEvent.click(trigger)
    await userEvent.click(
      await body.findByRole('menuitem', { name: 'Show past meals · 2 to catch up' }),
    )
    await expect(args.onToggle).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument())

    // Escape closes the menu without toggling.
    await userEvent.click(trigger)
    await expect(await body.findByRole('menu')).toBeInTheDocument()
    await pressEscape()
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument())
    await expect(args.onToggle).toHaveBeenCalledTimes(1)

    // The custom close handler still returns focus to the trigger.
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const OutsideClickKeepsFocus: Story = {
  args: { catchUpCount: 2 },
  decorators: [
    (Story) => (
      <div className="flex items-center gap-4">
        <Story />
        <input aria-label="Elsewhere" className="border-input rounded-md border px-2" />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('button', { name: /timeline options/i }))
    await expect(await body.findByRole('menu')).toBeInTheDocument()

    // Clicking another control closes the menu and leaves focus where the
    // user put it, rather than pulling it back to the trigger.
    const elsewhere = canvas.getByRole('textbox', { name: 'Elsewhere' })
    await userEvent.click(elsewhere)
    await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument())
    await expect(elsewhere).toHaveFocus()
  },
}
