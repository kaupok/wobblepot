import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { mealHueStyle } from './MealImageCard'
import { NutritionSummary } from './NutritionSummary'

/**
 * Widths of the real surfaces: `default` as on a phone's recipe card, `lg` as
 * the cook view's nutrition column.
 */
const WIDTH = { default: 'w-72', lg: 'w-96' } as const

const meta = {
  title: 'Meal plan/NutritionSummary',
  component: NutritionSummary,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Per-serving nutrition (HON-1109): calories, a bar split by each macro’s share of the energy (protein, carbs, fat at 4/4/9 kcal a gram), and each macro’s grams over its name. `lg` is the cook view; `default` the recipe cards and the recipe form. The legend sits under its own parts when every label fits ("aligned"); otherwise it pins to the start, middle and end of the row with a swatch before each name ("pinned"). When any component has `isVague: true`, an (i) button follows "per serving" (HON-764, HON-930).',
      },
    },
  },
  args: {
    nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
    size: 'default',
  },
  decorators: [
    (Story, { args }) => (
      <div className={WIDTH[args.size ?? 'default']}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NutritionSummary>

export default meta
type Story = StoryObj<typeof meta>

const LABEL = 'About these numbers'
const EXPLANATION = 'Includes estimates for vague quantities like “to taste”.'

const BALANCED = { calories: 520, protein: 42, carbs: 30, fat: 28 }
const LOW_CARB = { calories: 610, protein: 38, carbs: 6, fat: 48 }
const HIGH_CARB = { calories: 640, protein: 18, carbs: 104, fat: 14 }

const root = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-mode]')!

const box = (element: Element) => element.getBoundingClientRect()

/** The legend's entries (grams over name), in macro order. */
const labels = (canvasElement: HTMLElement) => [
  ...canvasElement.querySelectorAll<HTMLElement>('[data-macro]'),
]

const expectNoInfo: Story['play'] = async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  await expect(canvasElement.textContent).not.toContain('*')
}

// The popover portals to the body, so it is found there. Its text is read from
// the dialog: the button's sr-only description carries the same sentence.
const expectInfo: Story['play'] = async ({ canvasElement }) => {
  await expect(canvasElement.textContent).not.toContain('*')
  const button = within(canvasElement).getByRole('button', { name: LABEL })
  await expect(button.previousElementSibling).toHaveTextContent(/per serving|portsjoni kohta/)
  await userEvent.click(button)
  const popover = await within(document.body).findByRole('dialog', { name: LABEL })
  await expect(within(popover).getByText(EXPLANATION)).toBeInTheDocument()
}

/** Each label starts within 1px of its part's left edge. */
async function expectAligned(canvasElement: HTMLElement) {
  await waitFor(() => expect(root(canvasElement)).toHaveAttribute('data-mode', 'aligned'))
  const parts = [...canvasElement.querySelectorAll<HTMLElement>('[data-macro-part]')]
  const entries = labels(canvasElement)
  await expect(parts.map((part) => part.dataset.macroPart)).toEqual(['protein', 'carbs', 'fat'])
  for (const [index, entry] of entries.entries()) {
    await expect(Math.abs(box(entry).left - box(parts[index]!).left)).toBeLessThanOrEqual(1)
  }
}

/** No two legend entries overlap, and every one lies inside the component. */
async function expectNoOverlap(canvasElement: HTMLElement) {
  const outer = box(root(canvasElement))
  const entries = labels(canvasElement).map(box)
  for (const [index, entry] of entries.entries()) {
    await expect(entry.left).toBeGreaterThanOrEqual(outer.left - 0.5)
    await expect(entry.right).toBeLessThanOrEqual(outer.right + 0.5)
    const next = entries[index + 1]
    if (next) await expect(entry.right).toBeLessThanOrEqual(next.left)
  }
}

async function expectPinned(canvasElement: HTMLElement) {
  await waitFor(() => expect(root(canvasElement)).toHaveAttribute('data-mode', 'pinned'))
  // A swatch before each name, because the names no longer sit under parts.
  await expect(canvasElement.querySelectorAll('[data-macro] span[aria-hidden]')).toHaveLength(3)
  await expectNoOverlap(canvasElement)
}

/** 42 / 30 / 28 g: 31 / 22 / 47 of the energy. Every English label fits its part. */
export const Balanced: Story = {
  play: async (context) => {
    await expectAligned(context.canvasElement)
    await expectNoInfo(context)
  },
}

/** The cook view's size: each label starts at its own part's left edge. */
export const BalancedLarge: Story = {
  args: { size: 'lg' },
  play: async ({ canvasElement }) => {
    await expectAligned(canvasElement)
    await expect(root(canvasElement).querySelector('[data-macro-part]')).toHaveClass('h-3')
  },
}

/** Carbs are 4% of the energy, so "Carbs" cannot sit under its part. */
export const LowCarb: Story = {
  args: { nutrition: LOW_CARB },
  play: async ({ canvasElement }) => expectPinned(canvasElement),
}

export const LowCarbLarge: Story = {
  args: { nutrition: LOW_CARB, size: 'lg' },
  play: async ({ canvasElement }) => expectPinned(canvasElement),
}

/** Protein is 12% of the energy. */
export const HighCarb: Story = {
  args: { nutrition: HIGH_CARB },
  play: async ({ canvasElement }) => expectNoOverlap(canvasElement),
}

export const HighCarbLarge: Story = {
  args: { nutrition: HIGH_CARB, size: 'lg' },
  play: async ({ canvasElement }) => expectNoOverlap(canvasElement),
}

/** A macro at 0g has no part and no gap, and its "0g" stays in the legend. */
export const ZeroFat: Story = {
  args: { nutrition: { calories: 300, protein: 25, carbs: 45, fat: 0 } },
  play: async ({ canvasElement }) => {
    const parts = canvasElement.querySelectorAll<HTMLElement>('[data-macro-part]')
    await expect([...parts].map((part) => part.dataset.macroPart)).toEqual(['protein', 'carbs'])
    await expect(within(canvasElement).getByText('0g')).toBeInTheDocument()
    await expectPinned(canvasElement)
  },
}

/** Nothing to split: no bar, and the legend without swatches. */
export const AllZero: Story = {
  args: { nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('macro-split')).not.toBeInTheDocument()
    await expectNoOverlap(canvasElement)
  },
}

/** "Süsivesikud" is wider than a 22% part on a card. */
export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('portsjoni kohta')).toBeInTheDocument()
    await expectPinned(canvasElement)
  },
}

export const EstonianLarge: Story = {
  args: { size: 'lg' },
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => expectNoOverlap(canvasElement),
}

export const WithVagueEstimates: Story = {
  args: { components: [{ isVague: true }, { isVague: false }] },
  play: expectInfo,
}

export const WithVagueEstimatesLarge: Story = {
  args: { size: 'lg', components: [{ isVague: true }] },
  play: expectInfo,
}

/**
 * Four-digit values exercise the locale-aware `formatInteger` path (HON-556):
 * under the Storybook locale toggle, `en` renders "1,250 kcal" while `et`
 * renders "1250 kcal" — CLDR Estonian only groups at 5+ digits ("10 000"),
 * so the absence of the en comma is the locale-correct behavior here.
 */
export const FourDigitCalories: Story = {
  args: { nutrition: { calories: 1250, protein: 95, carbs: 130, fat: 48 } },
}

/** The parts take the meal's hue on a tinted card; a meal without one stays grey. */
function OnTints({ size }: { size: 'default' | 'lg' }) {
  return (
    <div className="flex flex-col gap-4">
      {[30, 150, 260].map((hue) => (
        <Card key={hue} data-meal-surface="" style={mealHueStyle(hue)}>
          <CardContent>
            <NutritionSummary nutrition={BALANCED} size={size} />
          </CardContent>
        </Card>
      ))}
      <Card data-meal-surface="neutral">
        <CardContent>
          <NutritionSummary nutrition={LOW_CARB} size={size} />
        </CardContent>
      </Card>
    </div>
  )
}

export const OnMealTint: Story = {
  render: (args) => <OnTints size={args.size ?? 'default'} />,
}

export const OnMealTintLarge: Story = {
  args: { size: 'lg' },
  render: (args) => <OnTints size={args.size ?? 'default'} />,
}

export const OnMealTintDark: Story = {
  globals: { theme: 'dark' },
  render: (args) => <OnTints size={args.size ?? 'default'} />,
}

export const Dark: Story = {
  args: { size: 'lg' },
  globals: { theme: 'dark' },
}
