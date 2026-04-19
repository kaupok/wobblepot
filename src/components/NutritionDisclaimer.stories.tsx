import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { NutritionDisclaimer } from './NutritionDisclaimer'

const meta = {
  title: 'UI/NutritionDisclaimer',
  component: NutritionDisclaimer,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Muted-body disclaimer rendered once per page near nutrition blocks. Copy is fixed via `NUTRITION_DISCLAIMER_TEXT`. Currently rendered on `MealDetail` (meal detail surface) and `MealForm` (create/edit). **Future surfaces** that must also render this when they ship: Today-dashboard nutrition rollup and the member-preferences macro-targets UI.',
      },
    },
  },
} satisfies Meta<typeof NutritionDisclaimer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const AllThemes: Story = {
  name: 'Light and dark',
  parameters: {
    docs: {
      description: {
        story:
          'Renders the disclaimer in both light and dark themes side-by-side so contrast can be checked in review.',
      },
    },
  },
  render: () => (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="bg-background text-foreground max-w-xs rounded-md border p-4">
        <NutritionDisclaimer />
      </div>
      <div className="dark bg-background text-foreground max-w-xs rounded-md border p-4">
        <NutritionDisclaimer />
      </div>
    </div>
  ),
}
