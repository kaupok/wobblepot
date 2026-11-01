import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Clock } from 'lucide-react'
import { expect, waitFor, within } from 'storybook/test'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

import { KidFriendlyBadge } from './KidFriendlyBadge'
import { MealBadgeRow } from './MealBadgeRow'
import { mealHueStyle } from './MealImageCard'
import { MealTypeBadge } from './MealTypeBadge'
import { ProteinBadge } from './ProteinBadge'

/**
 * The recipe library card's row from the report: two slots, Kid-friendly,
 * protein, time; `allSlots` adds Breakfast.
 */
function LibraryRow({
  width,
  protein = 'legume',
  allSlots = false,
}: {
  width: 'w-72' | 'w-75' | 'w-104' | 'w-140'
  protein?: 'legume' | 'fish'
  allSlots?: boolean
}) {
  return (
    <Card data-meal-surface="" className={width} style={mealHueStyle(52)}>
      <CardContent className="p-4">
        <MealBadgeRow>
          {allSlots && <MealTypeBadge mealType="breakfast" />}
          <MealTypeBadge mealType="lunch" />
          <MealTypeBadge mealType="dinner" />
          <KidFriendlyBadge compact />
          <ProteinBadge proteinType={protein} />
          <Badge variant="surface" className="ml-auto">
            <Clock aria-hidden="true" />
            65 min
          </Badge>
        </MealBadgeRow>
      </CardContent>
    </Card>
  )
}

const meta = {
  title: 'Meal plan/MealBadgeRow',
  component: MealBadgeRow,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          "A meal card's first badge row, held to one line (HON-1575). When the badges do not fit they overlap and the slot and protein labels cut short; hover a badge to see its full label while the others contract. Icon and time badges keep their width.",
      },
    },
  },
  args: { children: null },
} satisfies Meta<typeof MealBadgeRow>

export default meta
type Story = StoryObj<typeof meta>

const badges = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-slot="badge"]'))

/**
 * Room for every badge: a gap between them, no overlap, nothing cut, and a
 * short label keeps its own width rather than the overlap's floor.
 */
export const Roomy: Story = {
  render: () => <LibraryRow width="w-140" protein="fish" />,
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>('[data-slot="badge"]')!.parentElement!
    await expect(row).not.toHaveAttribute('data-overlap')
    for (const label of canvasElement.querySelectorAll<HTMLElement>('.truncate')) {
      await expect(label.scrollWidth).toBe(label.clientWidth)
    }
    // Its label plus the badge's 10px padding and 1px border a side, not
    // stretched to the overlap's floor. Measured, not a fixed width, so the
    // CI font's metrics cannot move it.
    const label = within(canvasElement).getByText('Fish')
    const fish = label.closest<HTMLElement>('[data-slot="badge"]')!
    await expect(Math.round(fish.getBoundingClientRect().width)).toBe(
      Math.round(label.getBoundingClientRect().width + 22),
    )
  },
}

/**
 * The report's card in Estonian: the row stays one line, the badges overlap,
 * and the time stays on the row rather than dropping to a line of its own.
 */
export const Narrow: Story = {
  globals: { locale: 'et' },
  render: () => <LibraryRow width="w-75" />,
  play: async ({ canvasElement }) => {
    const all = badges(canvasElement)
    const first = all[0]!
    const row = first.parentElement!
    await waitFor(() => expect(row).toHaveAttribute('data-overlap'))
    const top = Math.round(first.getBoundingClientRect().top)
    for (const badge of all) {
      await expect(Math.round(badge.getBoundingClientRect().top)).toBe(top)
      await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(
        row.getBoundingClientRect().right + 0.5,
      )
    }
    // Every label is still in the accessibility tree.
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Lõunasöök')).toBeInTheDocument()
    await expect(canvas.getByText('Kaunviljad')).toBeInTheDocument()
  },
}

/**
 * The tightest case on `/recipes`: a recipe for all three meals on a 254px
 * row (a two-column grid at 640px, or a 320px phone). Every badge stays
 * inside the row.
 */
export const AllSlotsNarrowest: Story = {
  globals: { locale: 'et' },
  render: () => <LibraryRow width="w-72" allSlots />,
  play: async ({ canvasElement }) => {
    const all = badges(canvasElement)
    const row = all[0]!.parentElement!
    await waitFor(() => expect(row).toHaveAttribute('data-overlap'))
    const { left, right } = row.getBoundingClientRect()
    for (const badge of all) {
      await expect(badge.getBoundingClientRect().left).toBeGreaterThanOrEqual(left - 0.5)
      await expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(right + 0.5)
    }
  },
}

/**
 * A row a little too narrow: the overlap frees more room than it lacked, so
 * nothing is cut, and the time still ends the row at its right edge
 * (HON-1352) rather than tucking under the protein badge.
 */
export const SlightlyNarrow: Story = {
  globals: { locale: 'et' },
  render: () => <LibraryRow width="w-104" />,
  play: async ({ canvasElement }) => {
    const all = badges(canvasElement)
    const row = all[0]!.parentElement!
    await waitFor(() => expect(row).toHaveAttribute('data-overlap'))
    for (const label of canvasElement.querySelectorAll<HTMLElement>('.truncate')) {
      await expect(label.scrollWidth).toBe(label.clientWidth)
    }
    await expect(Math.round(all.at(-1)!.getBoundingClientRect().right)).toBe(
      Math.round(row.getBoundingClientRect().right),
    )
  },
}

/**
 * Hover "Kaunviljad" here: it takes its full label and the others contract.
 * No play function, because Testing Library's `hover` fires events but never
 * sets CSS `:hover`, which is what the row reads.
 */
export const NarrowHover: Story = {
  globals: { locale: 'et' },
  render: () => <LibraryRow width="w-75" />,
}

export const NarrowDark: Story = {
  globals: { locale: 'et', theme: 'dark' },
  render: () => <LibraryRow width="w-75" />,
}
