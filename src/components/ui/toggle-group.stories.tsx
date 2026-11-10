import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ToggleGroup, ToggleGroupItem } from './toggle-group'

const meta = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A row of `Toggle` parts with one outline, a segmented control. It takes `Toggle`\'s `variant`, `tone`, `size` and `indicator` and hands them to each part; a part\'s own `tone` overrides the group\'s. `type="single"` makes the group a `radiogroup` and gives each part `role="radio"` with `aria-checked`, and the arrow keys move between the parts.',
      },
    },
  },
  args: {
    type: 'single',
    variant: 'outline',
    tone: 'primary',
    size: 'sm-touch',
    indicator: true,
    defaultValue: 'week',
    'aria-label': 'Range',
    onValueChange: fn(),
  },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="day">Day</ToggleGroupItem>
      <ToggleGroupItem value="week">Week</ToggleGroupItem>
      <ToggleGroupItem value="month">Month</ToggleGroupItem>
    </ToggleGroup>
  ),
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

/** One pressed part; a press on another moves the check and `aria-checked` to it. */
export const Single: Story = {
  play: async ({ canvasElement, args }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Range' })
    const week = within(group).getByRole('radio', { name: 'Week' })
    await expect(week).toHaveAttribute('aria-checked', 'true')
    const month = within(group).getByRole('radio', { name: 'Month' })
    await userEvent.click(month)
    await expect(month).toHaveAttribute('aria-checked', 'true')
    await expect(week).toHaveAttribute('aria-checked', 'false')
    await expect(args.onValueChange).toHaveBeenCalledWith('month')
    // Arrow keys move focus between the parts.
    await userEvent.keyboard('{ArrowLeft}')
    await expect(week).toHaveFocus()
  },
}

export const DefaultSize: Story = {
  args: { size: 'default' },
}

export const NoIndicator: Story = {
  args: { indicator: false, tone: 'default' },
}

/**
 * `xs-touch` with the pantry stock control's Estonian labels (HON-1637): a 28px
 * group whose parts each have a 44px target, from an `::after` that reaches 8px
 * above and below. The pressed part shows the check and the fill.
 */
export const XsTouch: Story = {
  args: { size: 'xs-touch', defaultValue: 'low', 'aria-label': 'Varu' },
  globals: { locale: 'et' },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="haveIt">Olemas</ToggleGroupItem>
      <ToggleGroupItem value="low">Vähe</ToggleGroupItem>
      <ToggleGroupItem value="ranOut">Otsas</ToggleGroupItem>
    </ToggleGroup>
  ),
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole('radiogroup', { name: 'Varu' })
    await expect(group.getBoundingClientRect().height).toBe(28)
    for (const radio of within(group).getAllByRole('radio')) {
      await expect(radio.getBoundingClientRect().height).toBe(28)
      const target = getComputedStyle(radio, '::after')
      await expect(target.top).toBe('-8px')
      await expect(target.bottom).toBe('-8px')
    }
    const low = within(group).getByRole('radio', { name: 'Vähe' })
    await expect(low).toHaveAttribute('aria-checked', 'true')
    const check = low.querySelector('[data-slot="toggle-indicator"]')
    if (!check) throw new Error('expected a check in the pressed part')
    await expect(getComputedStyle(check).display).not.toBe('none')
    await expect(check.getBoundingClientRect().height).toBe(14)
    // The fill: the pressed part's background differs from a part at rest.
    const olemas = within(group).getByRole('radio', { name: 'Olemas' })
    await expect(getComputedStyle(low).backgroundColor).not.toBe(
      getComputedStyle(olemas).backgroundColor,
    )
    const restCheck = olemas.querySelector('[data-slot="toggle-indicator"]')
    if (!restCheck) throw new Error('expected a check in each part')
    await expect(getComputedStyle(restCheck).display).toBe('none')
  },
}

/**
 * A part's own `tone` overrides the group's (HON-1641): the pantry stock
 * control keeps its normal state, Have it, on the quiet `default` tone, and
 * tints Low and Ran out with `warning`, so the rows that need attention stand
 * out. Each group presses a different part.
 */
export const PerPartTones: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['haveIt', 'low', 'ranOut'] as const).map((value) => (
        <ToggleGroup
          key={value}
          type="single"
          variant="outline"
          size="xs-touch"
          indicator
          defaultValue={value}
          aria-label={`Stock ${value}`}
        >
          <ToggleGroupItem value="haveIt" tone="default">
            Have it
          </ToggleGroupItem>
          <ToggleGroupItem value="low" tone="warning">
            Low
          </ToggleGroupItem>
          <ToggleGroupItem value="ranOut" tone="warning">
            Ran out
          </ToggleGroupItem>
        </ToggleGroup>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const haveIt = within(canvas.getByRole('radiogroup', { name: 'Stock haveIt' })).getByRole(
      'radio',
      { name: 'Have it' },
    )
    await expect(haveIt).toHaveClass('data-[state=on]:bg-accent')
    await expect(haveIt).not.toHaveClass('data-[state=on]:bg-primary')
    const low = within(canvas.getByRole('radiogroup', { name: 'Stock low' })).getByRole('radio', {
      name: 'Low',
    })
    await expect(low).toHaveClass(
      'data-[state=on]:bg-warning-muted',
      'data-[state=on]:text-warning',
    )
    // The part's tone, not the group's: a pressed Low and a pressed Have it differ.
    await expect(getComputedStyle(low).backgroundColor).not.toBe(
      getComputedStyle(haveIt).backgroundColor,
    )
  },
}

/** `PerPartTones` in the dark theme, so the a11y run measures the tints there too. */
export const PerPartTonesDark: Story = {
  ...PerPartTones,
  globals: { theme: 'dark' },
}
