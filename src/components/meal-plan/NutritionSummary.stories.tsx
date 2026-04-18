import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { NutritionSummary } from './NutritionSummary'

const meta = {
  title: 'Meal plan/NutritionSummary',
  component: NutritionSummary,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Per-serving macro summary rendered on the meal detail view. Defaults to a two-column label/value grid; the `compact` variant renders a single interpunct-separated line. When any component has `isVague: true`, a `*` is appended to the heading (or the compact line) and a footnote is shown in the full layout.',
      },
    },
  },
  args: {
    nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
  },
} satisfies Meta<typeof NutritionSummary>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Compact: Story = {
  args: { compact: true },
}

export const WithVagueEstimates: Story = {
  args: {
    components: [{ isVague: true }, { isVague: false }],
  },
}

export const CompactWithVagueEstimates: Story = {
  args: {
    compact: true,
    components: [{ isVague: true }],
  },
}
