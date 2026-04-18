import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Checkbox } from './checkbox'
import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'UI/Label',
  component: Label,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: {
    children: 'Label',
  },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithInput: Story = {
  render: () => (
    <div className="grid w-72 gap-2">
      <Label htmlFor="email">Email</Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
}

export const WithCheckbox: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="kid-friendly" />
      <Label htmlFor="kid-friendly">Kid-friendly</Label>
    </div>
  ),
}

export const Disabled: Story = {
  render: () => (
    <div className="group grid w-72 gap-2" data-disabled="true">
      <Label htmlFor="disabled-input">Disabled label</Label>
      <Input id="disabled-input" disabled defaultValue="Read-only" />
    </div>
  ),
}

// WHY: The disabled wrapper dims the label to 50% opacity via
// `group-data-[disabled=true]:opacity-50`. WCAG 1.4.3 exempts inactive UI
// components from the contrast requirement — axe can't infer disabled state
// from opacity classes, so waive only `color-contrast`.
export const AllVariants: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  render: () => (
    <div className="grid w-72 gap-6">
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">Default</p>
        <Label>Plain label</Label>
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">With htmlFor + input</p>
        <Label htmlFor="av-label-email">Email</Label>
        <Input id="av-label-email" type="email" placeholder="you@example.com" />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">With checkbox</p>
        <div className="flex items-center gap-2">
          <Checkbox id="av-label-checkbox" />
          <Label htmlFor="av-label-checkbox">Kid-friendly</Label>
        </div>
      </section>
      <section className="group flex flex-col gap-2" data-disabled="true">
        <p className="text-muted-foreground text-xs">Disabled wrapper</p>
        <Label htmlFor="av-label-disabled">Disabled label</Label>
        <Input id="av-label-disabled" disabled defaultValue="Disabled value" />
      </section>
    </div>
  ),
}
