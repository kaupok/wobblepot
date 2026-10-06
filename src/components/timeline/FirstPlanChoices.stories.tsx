import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { FirstPlanChoices } from './FirstPlanChoices'

const startDateOptions = [
  { label: 'Today', date: '2026-10-07' },
  { label: 'Tomorrow', date: '2026-10-08' },
  { label: 'Fri (Oct 9)', date: '2026-10-09' },
  { label: 'Sat (Oct 10)', date: '2026-10-10' },
  { label: 'Sun (Oct 11)', date: '2026-10-11' },
]
const daysCountOptions = [3, 5, 7, 10, 14].map((value) => ({ value }))

const meta = {
  title: 'Feature/Timeline/FirstPlanChoices',
  component: FirstPlanChoices,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          "The first plan's start day and length, and on onboarding's step 3 the line that says the first plan is dinners only. Shared by onboarding's last step and Today's `FirstTimeSetup`.",
      },
    },
  },
  args: {
    startDateOptions,
    daysCountOptions,
    selectedDate: '2026-10-07',
    onSelectedDateChange: fn(),
    daysCount: 7,
    onDaysCountChange: fn(),
  },
  render: function Render(args) {
    const [selectedDate, setSelectedDate] = useState(args.selectedDate)
    const [daysCount, setDaysCount] = useState(args.daysCount)
    return (
      <div className="max-w-md">
        <FirstPlanChoices
          {...args}
          selectedDate={selectedDate}
          onSelectedDateChange={(date) => {
            setSelectedDate(date)
            args.onSelectedDateChange(date)
          }}
          daysCount={daysCount}
          onDaysCountChange={(count) => {
            setDaysCount(count)
            args.onDaysCountChange(count)
          }}
        />
      </div>
    )
  },
} satisfies Meta<typeof FirstPlanChoices>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    // Today's `FirstTimeSetup` cannot know the household is still on the
    // dinner-only defaults, so the line is off unless a screen asks for it.
    await expect(within(canvasElement).queryByText(/we start with dinners/i)).toBeNull()

    const canvas = within(canvasElement)
    const daysCount = within(canvas.getByRole('radiogroup', { name: 'How many days' }))

    await userEvent.click(daysCount.getByRole('radio', { name: '3 days' }))

    await expect(args.onDaysCountChange).toHaveBeenCalledWith(3)
    await expect(daysCount.getByRole('radio', { name: '3 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  },
}

export const Disabled: Story = {
  args: { disabled: true },
}

export const OnboardingStep: Story = {
  args: { headingAs: 'h2', showDefaultsNote: true },
  parameters: {
    docs: {
      description: {
        story:
          "Onboarding's step 3: the group headings sit directly under the page `h1`, and the line says the first plan is dinners only, which holds just after the household is created.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { level: 2, name: 'Start from' })).toBeVisible()
    await expect(canvas.getByText(/we start with dinners/i)).toBeVisible()
  },
}
