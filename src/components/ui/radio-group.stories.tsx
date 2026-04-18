import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Label } from './label'
import { RadioGroup, RadioGroupItem } from './radio-group'

const meta = {
  title: 'UI/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="weekly">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="daily" id="daily" />
        <Label htmlFor="daily">Daily</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="weekly" id="weekly" />
        <Label htmlFor="weekly">Weekly</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="monthly" id="monthly" />
        <Label htmlFor="monthly">Monthly</Label>
      </div>
    </RadioGroup>
  ),
}

export const WithDisabledOption: Story = {
  render: () => (
    <RadioGroup defaultValue="planned">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="planned" id="status-planned" />
        <Label htmlFor="status-planned">Planned</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="completed" id="status-completed" />
        <Label htmlFor="status-completed">Completed</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="skipped" id="status-skipped" disabled />
        <Label htmlFor="status-skipped">Skipped (disabled)</Label>
      </div>
    </RadioGroup>
  ),
}

export const NoSelection: Story = {
  render: () => (
    <RadioGroup>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="a" id="opt-a" />
        <Label htmlFor="opt-a">Option A</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="b" id="opt-b" />
        <Label htmlFor="opt-b">Option B</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="c" id="opt-c" />
        <Label htmlFor="opt-c">Option C</Label>
      </div>
    </RadioGroup>
  ),
}

// WHY: Full-group and per-item disabled states render at 50% opacity. WCAG
// 1.4.3 exempts inactive UI components from contrast requirements — axe can't
// infer disabled state from opacity classes, so the waiver is rule-scoped.
export const AllVariants: Story = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  render: () => (
    <div className="grid gap-6 sm:grid-cols-2">
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">Default selected</p>
        <RadioGroup defaultValue="weekly">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="daily" id="av-daily" />
            <Label htmlFor="av-daily">Daily</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="weekly" id="av-weekly" />
            <Label htmlFor="av-weekly">Weekly</Label>
          </div>
        </RadioGroup>
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">No selection</p>
        <RadioGroup>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="a" id="av-none-a" />
            <Label htmlFor="av-none-a">Option A</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="b" id="av-none-b" />
            <Label htmlFor="av-none-b">Option B</Label>
          </div>
        </RadioGroup>
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">Disabled option</p>
        <RadioGroup defaultValue="planned">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="planned" id="av-planned" />
            <Label htmlFor="av-planned">Planned</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="skipped" id="av-skipped" disabled />
            <Label htmlFor="av-skipped">Skipped</Label>
          </div>
        </RadioGroup>
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">Whole group disabled</p>
        <RadioGroup defaultValue="weekly" disabled>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="daily" id="av-gd-daily" />
            <Label htmlFor="av-gd-daily">Daily</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="weekly" id="av-gd-weekly" />
            <Label htmlFor="av-gd-weekly">Weekly</Label>
          </div>
        </RadioGroup>
      </section>
    </div>
  ),
}
