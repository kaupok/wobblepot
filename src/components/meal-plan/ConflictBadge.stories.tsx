import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { ConflictBadge, ConflictBadges } from './ConflictBadge'
import { mealHueStyle } from './MealImageCard'
import { MealTypeBadge } from './MealTypeBadge'
import { ProteinBadge } from './ProteinBadge'
import type { PreferenceConflict } from '@/lib/meal-planning/preference-conflicts'

const meta = {
  title: 'Meal plan/ConflictBadge',
  component: ConflictBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "A household food preference a planned meal breaks (HON-1126), on the planner card's first row and under the name in the cook view. A `destructive` badge with a `TriangleAlert` icon; the text names the constraint after a separator, so the enum label needs no declension in Estonian.",
      },
    },
  },
  args: { conflict: { kind: 'allergen', constraint: 'nuts' } },
} satisfies Meta<typeof ConflictBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Allergen: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Contains: Tree nuts')).toBeVisible()
  },
}

export const Diet: Story = {
  args: { conflict: { kind: 'diet', constraint: 'vegetarian' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Not suitable: Vegetarian')).toBeVisible()
  },
}

export const Excluded: Story = {
  args: { conflict: { kind: 'excluded', constraint: 'Mushrooms' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Has an avoided ingredient')).toBeVisible()
  },
}

/** The cook view's size, where text stays at 16px or above (HON-932). */
export const Large: Story = {
  args: { size: 'lg' },
}

export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Sisaldab: Pähklid')).toBeVisible()
  },
}

const ONE: PreferenceConflict[] = [{ kind: 'allergen', constraint: 'fish' }]
const THREE: PreferenceConflict[] = [
  { kind: 'allergen', constraint: 'nuts' },
  { kind: 'diet', constraint: 'vegan' },
  { kind: 'excluded', constraint: 'Mushrooms' },
]

/** The planner card's first row on a tinted card: slot, protein, then the conflicts. */
function BadgeRow({ conflicts }: { conflicts: PreferenceConflict[] }) {
  return (
    <Card data-meal-surface="" style={mealHueStyle(52)} className="w-[358px]">
      <CardContent className="flex flex-wrap items-center gap-1.5">
        <MealTypeBadge mealType="dinner" />
        <ProteinBadge proteinType="fish" />
        <ConflictBadges conflicts={conflicts} />
      </CardContent>
    </Card>
  )
}

export const RowWithOne: Story = {
  render: () => <BadgeRow conflicts={ONE} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-variant="destructive"]')).toHaveLength(1)
  },
}

export const RowWithThree: Story = {
  render: () => <BadgeRow conflicts={THREE} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-variant="destructive"]')).toHaveLength(3)
  },
}

export const RowWithThreeDark: Story = {
  ...RowWithThree,
  globals: { theme: 'dark' },
  play: undefined,
}
