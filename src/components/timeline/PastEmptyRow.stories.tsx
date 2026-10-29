import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { RowGroup } from '@/components/ui/row-group'
import { MealType } from '@/generated/prisma/enums'
import { fridgePantryItems } from '@/stories/fridge-fixtures'

import { PastEmptyRow } from './PastEmptyRow'

const meta = {
  title: 'Feature/Timeline/PastEmptyRow',
  component: PastEmptyRow,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    date: '2026-10-20',
    dayLabel: 'Tuesday Oct 20',
    mealType: MealType.dinner,
    householdServings: 4,
    pantryItems: fridgePantryItems,
    log: { frequentMeals: [], recentLabels: ['Wolt'] },
    onLogged: () => {},
  },
  // The row always sits in its day's `RowGroup`, which draws the box.
  decorators: [
    (Story) => (
      <RowGroup>
        <Story />
      </RowGroup>
    ),
  ],
} satisfies Meta<typeof PastEmptyRow>

export default meta
type Story = StoryObj<typeof meta>

/**
 * An expected dinner with nothing in it (HON-1383). Add names the day and is
 * described by the slot, and offers a recipe or a fridge meal only.
 */
export const Dinner: Story = {
  play: async ({ canvasElement }) => {
    const add = within(canvasElement).getByRole('button', { name: 'Add to Tuesday Oct 20' })
    await expect(add).toHaveAccessibleDescription('Dinner')
    // One tap, at the 44px touch floor below `md`.
    if (window.innerWidth < 768) {
      await expect(add.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }

    await userEvent.click(add)
    const menu = await within(document.body).findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Choose a recipe', 'Fridge meal'])
    await userEvent.keyboard('{Escape}')
  },
}

export const Estonian: Story = {
  args: { dayLabel: 'Teisipäev 20. okt' },
  globals: { locale: 'et' },
}
