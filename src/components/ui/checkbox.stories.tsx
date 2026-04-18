import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Checkbox } from './checkbox'
import { Label } from './label'

const meta = {
  title: 'UI/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Example checkbox' },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Unchecked: Story = {}

export const Checked: Story = {
  args: { defaultChecked: true },
}

export const Indeterminate: Story = {
  args: { checked: 'indeterminate' },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const DisabledChecked: Story = {
  args: { disabled: true, defaultChecked: true },
}

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="kid-friendly" defaultChecked />
      <Label htmlFor="kid-friendly">Kid-friendly</Label>
    </div>
  ),
}

// WHY: Disabled Radix checkboxes render at 50% opacity, which dips below 4.5:1
// for labels. WCAG 1.4.3 exempts text in inactive UI components from the
// contrast requirement — axe can't infer disabled state from opacity classes,
// so the waiver is rule-scoped.
export const AllVariants: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Checkbox id="v-unchecked" aria-label="Unchecked" />
        <Label htmlFor="v-unchecked">Unchecked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="v-checked" defaultChecked />
        <Label htmlFor="v-checked">Checked</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="v-indeterminate" checked="indeterminate" />
        <Label htmlFor="v-indeterminate">Indeterminate</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="v-disabled-unchecked" disabled />
        <Label htmlFor="v-disabled-unchecked">Disabled (unchecked)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="v-disabled-checked" disabled defaultChecked />
        <Label htmlFor="v-disabled-checked">Disabled (checked)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox aria-label="Standalone checkbox" defaultChecked />
        <span className="text-muted-foreground text-xs">Without label</span>
      </div>
    </div>
  ),
}
