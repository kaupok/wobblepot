import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { fn } from 'storybook/test'
import { PreparationTips } from './PreparationTips'
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
  component: PreparationTips,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div className="bg-muted/50 max-w-md rounded-lg p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreparationTips>

export default meta
type Story = StoryObj<typeof meta>

export const FullTips: Story = {
  args: {
    tips: fullTips,
    isLoading: false,
    error: null,
  },
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
