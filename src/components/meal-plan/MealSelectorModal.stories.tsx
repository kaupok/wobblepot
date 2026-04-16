import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import { MealSelectorModal } from './MealSelectorModal'

const meta = {
  title: 'Meal plan/MealSelectorModal',
  component: MealSelectorModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Meal picker with search, “my recipes only” filter and AI-imagine mode — portal-based. Without a mocked API layer, queries fail and the component shows loading skeletons followed by an empty / error state — the chrome is the primary thing to review here.',
      },
    },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    planId: 'plan-1',
    entryId: 'entry-1',
    householdSize: 4,
    mealType: MealType.dinner,
    onSwapComplete: fn(),
  },
} satisfies Meta<typeof MealSelectorModal>

export default meta
type Story = StoryObj<typeof meta>

export const SwapMode: Story = {
  args: {
    mode: 'swap',
    currentMealName: 'Lemon-garlic roast chicken',
  },
}

export const AddMode: Story = {
  args: {
    mode: 'add',
  },
}

export const BreakfastSlot: Story = {
  args: {
    mode: 'add',
    mealType: MealType.breakfast,
  },
}
