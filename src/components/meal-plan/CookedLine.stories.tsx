import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { CookedLine } from './CookedLine'

const meta = {
  title: 'Meal plan/CookedLine',
  component: CookedLine,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'When the household last cooked a recipe and when it plans it next, on the meal picker cards (HON-1388). Days for two weeks, weeks below 9 weeks, months after.',
      },
    },
  },
  args: { today: '2026-10-28', lastCookedOn: '2026-10-16', nextPlannedOn: null },
} satisfies Meta<typeof CookedLine>

export default meta
type Story = StoryObj<typeof meta>

export const DaysAgo: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Cooked 12 days ago')).toBeVisible()
  },
}

export const Yesterday: Story = {
  args: { lastCookedOn: '2026-10-27' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Cooked yesterday')).toBeVisible()
  },
}

export const WeeksAgo: Story = {
  args: { lastCookedOn: '2026-09-20' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Cooked 5 weeks ago')).toBeVisible()
  },
}

export const MonthsAgo: Story = {
  args: { lastCookedOn: '2026-06-01' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Cooked 4 months ago')).toBeVisible()
  },
}

/** Never cooked and already planned: the picker's My recipes view lists it last. */
export const NotCookedYetPlanned: Story = {
  args: { lastCookedOn: null, nextPlannedOn: '2026-10-31' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Not cooked yet · Planned: Sat, Oct 31'),
    ).toBeVisible()
  },
}
