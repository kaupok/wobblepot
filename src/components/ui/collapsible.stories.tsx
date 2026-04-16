import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from './button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible'

const meta = {
  title: 'UI/Collapsible',
  component: Collapsible,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

const items = ['Lemon-garlic roast chicken', 'Sheet-pan salmon with broccoli', 'Mushroom risotto']

export const Closed: Story = {
  render: () => (
    <Collapsible className="w-80 space-y-2">
      <div className="flex items-center justify-between rounded-md border px-4 py-2">
        <span className="text-sm font-medium">This week&apos;s meals (3)</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Toggle">
            <ChevronDownIcon />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-1 px-4">
        {items.map((item) => (
          <div key={item} className="rounded-md border px-3 py-2 text-sm">
            {item}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  ),
}

export const Open: Story = {
  render: () => (
    <Collapsible defaultOpen className="w-80 space-y-2">
      <div className="flex items-center justify-between rounded-md border px-4 py-2">
        <span className="text-sm font-medium">This week&apos;s meals (3)</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Toggle">
            <ChevronDownIcon />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-1 px-4">
        {items.map((item) => (
          <div key={item} className="rounded-md border px-3 py-2 text-sm">
            {item}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  ),
}
