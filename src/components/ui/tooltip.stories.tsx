import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

const meta = {
  title: 'UI/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A label for a control on hover and keyboard focus. The same surface as `Popover` and so as `InfoTip`: popover tokens, border, `shadow-md`, no arrow. Its trigger must be focusable, or the label is a mouse hint only. It never opens on tap, so an explanation a phone has to reach is an `InfoTip`. Never the native `title` attribute: the browser draws that outside the theme. Toggle the theme toolbar to verify content renders correctly in dark mode.',
      },
    },
  },
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover me</Button>
      </TooltipTrigger>
      <TooltipContent>Tooltip text</TooltipContent>
    </Tooltip>
  ),
}

export const AllSides: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-16 p-16">
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Top</Button>
        </TooltipTrigger>
        <TooltipContent side="top">Top tooltip</TooltipContent>
      </Tooltip>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Right</Button>
        </TooltipTrigger>
        <TooltipContent side="right">Right tooltip</TooltipContent>
      </Tooltip>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Bottom</Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Bottom tooltip</TooltipContent>
      </Tooltip>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Left</Button>
        </TooltipTrigger>
        <TooltipContent side="left">Left tooltip</TooltipContent>
      </Tooltip>
    </div>
  ),
}

/** `size="lg"`: 16px text, for the cook view (HON-981). */
export const Large: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button variant="ghost">Ask</Button>
      </TooltipTrigger>
      <TooltipContent size="lg">Ask about step 2</TooltipContent>
    </Tooltip>
  ),
  play: async () => {
    const tooltip = await within(document.body).findByRole('tooltip')
    const content = tooltip.closest('[data-slot="tooltip-content"]') ?? tooltip.parentElement!
    await expect(getComputedStyle(content).fontSize).toBe('16px')
  },
}

export const LongContent: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button variant="outline">Pantry hit</Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-48">
        You already have 4 of 6 ingredients in your pantry — only olive oil and lemons missing.
      </TooltipContent>
    </Tooltip>
  ),
}
