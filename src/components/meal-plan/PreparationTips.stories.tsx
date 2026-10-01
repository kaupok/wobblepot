import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, within } from 'storybook/test'
import { mealHueStyle } from './MealImageCard'
import { PreparationEquipment, PreparationSteps } from './PreparationTips'
import type { StructuredTips } from './types'

const fullTips: StructuredTips = {
  equipment: ['Sheet pan', 'Sharp chef’s knife', 'Instant-read thermometer'],
  steps: [
    'Preheat oven to 220°C (425°F).',
    'Pat chicken thighs dry and season generously with salt and pepper.',
    'Toss with olive oil, smashed garlic and lemon slices on a sheet pan.',
    'Roast 30–35 minutes until the thickest part reads 74°C (165°F).',
  ],
  pitfalls: [
    'Don’t crowd the pan — chicken will steam instead of browning.',
    'Let rest 5 min before serving.',
  ],
  tip: 'Save the pan juices — spoon them back over the chicken when plating.',
}

const meta = {
  title: 'Meal plan/PreparationTips',
  component: PreparationSteps,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The cook view’s steps area (HON-932): the household’s notes, then numbered steps, Watch out and Tip at the step size, straight on the meal’s tint. `PreparationEquipment` is the “You’ll need” line that sits under the ingredients instead.',
      },
    },
  },
  args: {
    onRetry: fn(),
  },
  decorators: [
    // On a meal tint, as in the cook view.
    (Story) => (
      <div data-meal-surface="" style={mealHueStyle(52)} className="max-w-xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreparationSteps>

export default meta
type Story = StoryObj<typeof meta>

export const FullTips: Story = {
  args: {
    tips: fullTips,
    isLoading: false,
    error: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Step text is the step level, foreground and 20px below `lg` (HON-932).
    const step = canvas.getByText(fullTips.steps![0]!)
    await expect(getComputedStyle(step).fontSize).toBe('20px')
    await expect(canvas.getByRole('heading', { name: 'Watch out' })).toBeVisible()
  },
}

export const Equipment: Story = {
  args: { tips: null, isLoading: false, error: null },
  render: () => <PreparationEquipment equipment={fullTips.equipment} />,
}

export const Loading: Story = {
  args: {
    tips: null,
    isLoading: true,
    error: null,
  },
}

export const Error: Story = {
  args: {
    tips: null,
    isLoading: false,
    error: 'Failed to load preparation tips.',
  },
}

export const UserNotesOnly: Story = {
  args: {
    tips: null,
    isLoading: false,
    error: null,
    preparationNotes: 'We usually skip the lemon and add chili flakes. Kids ate seconds last time.',
  },
}

export const UserNotesWithTips: Story = {
  args: {
    tips: fullTips,
    isLoading: false,
    error: null,
    preparationNotes: 'Double the garlic. Serve with couscous instead of rice.',
  },
}

export const PitfallsOnly: Story = {
  args: {
    tips: {
      pitfalls: ['Overcooking the garlic will turn it bitter — pull it once it’s golden.'],
    },
    isLoading: false,
    error: null,
  },
}
