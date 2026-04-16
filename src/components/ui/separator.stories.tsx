import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Separator } from './separator'

const meta = {
  title: 'UI/Separator',
  component: Separator,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <div className="w-72 space-y-3">
      <p className="text-sm font-medium">This week</p>
      <Separator />
      <p className="text-muted-foreground text-sm">Mon, Tue, Wed, Thu, Fri, Sat, Sun</p>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-3 text-sm">
      <span>Breakfast</span>
      <Separator orientation="vertical" />
      <span>Lunch</span>
      <Separator orientation="vertical" />
      <span>Dinner</span>
    </div>
  ),
}

export const InCard: Story = {
  render: () => (
    <div className="w-72 rounded-lg border p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Weekly plan</p>
        <p className="text-muted-foreground text-xs">Generated 2 hours ago</p>
      </div>
      <Separator className="my-3" />
      <div className="flex items-center justify-between text-sm">
        <span>Meals</span>
        <span className="text-muted-foreground">7</span>
      </div>
      <Separator className="my-3" />
      <div className="flex items-center justify-between text-sm">
        <span>Pantry hits</span>
        <span className="text-muted-foreground">12</span>
      </div>
    </div>
  ),
}
