import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import axe from 'axe-core'
import { expect, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { TimelineView } from '@/components/timeline/TimelineView'
import {
  createExpectedMealTypes,
  createPlanEntry,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
  timelineTodayDate,
  urgentShoppingItems,
} from '@/stories/fixtures'
import { GeneratingOverlay } from './GeneratingOverlay'

const meta = {
  title: 'Meal plan/GeneratingOverlay',
  component: GeneratingOverlay,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GeneratingOverlay>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Fixed full-screen overlay with a spinner and rotating progress messages. After 10s without change it switches to a “taking longer” fallback.',
      },
    },
  },
}

// Spinners are the one exemption from the reduced-motion override
// (docs/DESIGN.md → Motion, `globals.css`). Collapsed to a single 0.01ms turn
// like every other animation, the spinner would freeze and stop saying
// "loading". Forces the Storybook reduced-motion toolbar on and asserts the
// spinner still loops on its own cycle.
export const ReducedMotion: Story = {
  globals: {
    reducedMotion: 'on',
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true')
    })

    const spinner = canvasElement.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()

    const style = window.getComputedStyle(spinner as Element)
    expect(style.animationIterationCount).toBe('infinite')
    expect(style.animationDuration).toBe('1s')
  },
}

// Seven planned dinners from today, as in the `FullyPlanned` TimelineView story:
// enough text behind the scrim that the overlay's own copy has to hold up.
const plannedEntries = Array.from({ length: 7 }, (_, i) => {
  const day = new Date(timelineTodayDate)
  day.setDate(day.getDate() + i)
  const iso = day.toISOString().slice(0, 10)
  return createPlanEntry({ id: `e-planned-${iso}`, date: iso, mealType: MealType.dinner })
})

function OverTimeline() {
  return (
    <>
      <TimelineView
        planId="plan-1"
        householdServings={4}
        entries={plannedEntries}
        expectedMealTypes={createExpectedMealTypes()}
        pantryIngredients={lemonGarlicChickenPantry}
        pantryItems={lemonGarlicChickenPantryItems}
        shoppingItems={urgentShoppingItems}
        todayDate={timelineTodayDate}
      />
      <GeneratingOverlay />
    </>
  )
}

// HON-823: the scrim is a plain 80% wash, no blur (docs/DESIGN.md → Reject
// list, "glass effects"). These stories put a populated timeline behind it so
// the heading and status line are checked against what really sits under them.
//
// The story-level axe gate alone cannot pin that: axe reports text it cannot
// resolve a background for as `incomplete`, which does not fail the gate. So
// the play function runs `color-contrast` itself and requires both lines in
// `passes`. axe blends the backgrounds behind the scrim, not the page's text
// that shows faintly through it — if that text starts fighting the copy, raise
// the scrim's opacity; do not bring the blur back or add a card behind it.
async function assertScrimOverTimeline({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement)
  const heading = canvas.getByRole('heading', { name: 'Generating your meal plan…' })
  const status = canvas.getByText('Analyzing your preferences…')
  await expect(heading).toBeVisible()
  await expect(status).toBeVisible()

  const scrim = heading.closest('.fixed')
  expect(scrim).not.toBeNull()
  expect(window.getComputedStyle(scrim as Element).backdropFilter).toBe('none')

  const results = await axe.run(scrim as Element, { runOnly: ['color-contrast'] })
  const passed = results.passes.flatMap((rule) => rule.nodes.map((node) => node.html))
  expect(results.violations).toEqual([])
  expect(results.incomplete).toEqual([])
  expect(passed).toContainEqual(expect.stringContaining('Generating your meal plan…'))
  expect(passed).toContainEqual(expect.stringContaining('Analyzing your preferences…'))
}

export const OverPopulatedTimeline: Story = {
  render: () => <OverTimeline />,
  play: assertScrimOverTimeline,
}

export const OverPopulatedTimelineDark: Story = {
  globals: { theme: 'dark' },
  render: () => <OverTimeline />,
  play: assertScrimOverTimeline,
}
