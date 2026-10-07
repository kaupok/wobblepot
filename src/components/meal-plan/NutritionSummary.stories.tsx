import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Card, CardContent } from '@/components/ui/card'
import { mealHueStyle } from './MealImageCard'
import { NutritionSummary } from './NutritionSummary'

/**
 * Widths of the real surfaces: `default` as on a phone's recipe card, `lg` as
 * the cook view's nutrition column on a phone (the 350px row HON-1114 states
 * its placements for).
 */
const WIDTH = { default: 'w-72', lg: 'w-87.5' } as const

const meta = {
  title: 'Meal plan/NutritionSummary',
  component: NutritionSummary,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Per-serving nutrition (HON-1109): calories, a bar split by each macro’s share of the energy (protein, carbs, fat at 4/4/9 kcal a gram), and each macro’s grams over its name. `lg` is the cook view; `default` the recipe cards and the recipe form. Protein’s label is flush left and Fat’s flush right; Carbs centres under its part, clamped to keep 16px from both (HON-1114). When the three labels and two gaps do not fit, the legend is a plain row. When any component has `isVague: true`, an (i) button follows "per serving" (HON-764, HON-930).',
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
const LOW_PROTEIN = { calories: 529, protein: 10, carbs: 48, fat: 38 }
const FOUR_DIGIT = { calories: 1250, protein: 95, carbs: 130, fat: 48 }

const root = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-size]')!

const box = (element: Element) => element.getBoundingClientRect()

const legend = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-testid="macro-legend"]')!

/** The legend's entries (grams over name), in macro order. */
const labels = (canvasElement: HTMLElement) => [
  ...canvasElement.querySelectorAll<HTMLElement>('[data-macro]'),
]

const label = (canvasElement: HTMLElement, macro: string) =>
  canvasElement.querySelector<HTMLElement>(`[data-macro="${macro}"]`)!

const part = (canvasElement: HTMLElement, macro: string) =>
  canvasElement.querySelector<HTMLElement>(`[data-macro-part="${macro}"]`)!

const centre = (rect: DOMRect) => rect.left + rect.width / 2

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

/** No two legend entries overlap, and every one lies inside the component. */
async function expectNoOverlap(canvasElement: HTMLElement) {
  const outer = box(root(canvasElement))
  const entries = labels(canvasElement).map(box)
  for (const [index, entry] of entries.entries()) {
    await expect(entry.left).toBeGreaterThanOrEqual(outer.left - 0.5)
    await expect(entry.right).toBeLessThanOrEqual(outer.right + 0.5)
    for (const other of entries.slice(index + 1)) {
      const apart =
        entry.right <= other.left + 0.5 ||
        other.right <= entry.left + 0.5 ||
        entry.bottom <= other.top + 0.5 ||
        other.bottom <= entry.top + 0.5
      await expect(apart).toBe(true)
    }
  }
}

/** No colour swatch: the legend holds text only (HON-1114). */
async function expectNoSwatch(canvasElement: HTMLElement) {
  await expect(legend(canvasElement).querySelectorAll('[aria-hidden]')).toHaveLength(0)
  await expect(legend(canvasElement).querySelectorAll('[class*="bg-series"]')).toHaveLength(0)
}

/**
 * The fallback font sets wider, so geometry means something only once the web
 * font has landed; the legend's ResizeObserver re-measures when it does.
 */
async function loadFonts(canvasElement: HTMLElement) {
  const [family] = getComputedStyle(root(canvasElement)).fontFamily.split(',')
  await document.fonts.load(`600 16px ${family}`)
  await document.fonts.load(`400 14px ${family}`)
  await document.fonts.ready
}

/**
 * The one layout: Protein flush left, Fat flush right and right-aligned,
 * Carbs between with 16px to each, no swatch, no overlap. Waits for the
 * layout effect's measurement, which replaces the server's `%` estimate.
 */
async function expectPlaced(canvasElement: HTMLElement) {
  await loadFonts(canvasElement)
  await waitFor(() =>
    expect(legend(canvasElement).style.getPropertyValue('--macro-carbs-x')).toMatch(/px$/),
  )
  await expect(legend(canvasElement)).not.toHaveAttribute('data-fallback')
  const row = box(legend(canvasElement))
  const [protein, carbs, fat] = (['protein', 'carbs', 'fat'] as const).map((macro) =>
    box(label(canvasElement, macro)),
  )
  await expect(Math.abs(protein!.left - row.left)).toBeLessThanOrEqual(0.5)
  await expect(Math.abs(fat!.right - row.right)).toBeLessThanOrEqual(0.5)
  await expect(getComputedStyle(label(canvasElement, 'fat')).textAlign).toBe('right')
  await expect(carbs!.left - protein!.right).toBeGreaterThanOrEqual(16 - 0.5)
  await expect(fat!.left - carbs!.right).toBeGreaterThanOrEqual(16 - 0.5)
  await expectNoSwatch(canvasElement)
  await expectNoOverlap(canvasElement)
}

/** The cook view's grams at 16px semibold, the names at 14px regular, the bar at 6px. */
async function expectSizes(canvasElement: HTMLElement, gramsPx: number) {
  const [grams, name] = [...label(canvasElement, 'protein').children].map((el) =>
    getComputedStyle(el),
  )
  await expect(grams!.fontSize).toBe(`${gramsPx}px`)
  await expect(grams!.fontWeight).toBe('600')
  await expect(name!.fontSize).toBe('14px')
  await expect(name!.fontWeight).toBe('400')
  for (const bar of canvasElement.querySelectorAll('[data-macro-part]')) {
    await expect(box(bar).height).toBe(6)
  }
}

/** "per serving" on the calories' baseline, directly after them, in regular weight. */
async function expectPerServingInline(canvasElement: HTMLElement) {
  const kcal = within(canvasElement).getByText(/kcal$/)
  const perServing = within(canvasElement).getByText(/per serving|portsjoni kohta/)
  await expect(getComputedStyle(perServing).fontWeight).toBe('400')
  const gap = box(perServing).left - box(kcal).right
  await expect(gap).toBeGreaterThanOrEqual(7.5)
  await expect(gap).toBeLessThanOrEqual(8.5)
}

/** 42 / 30 / 28 g: 31 / 22 / 47 of the energy. */
export const Balanced: Story = {
  play: async (context) => {
    await expectPlaced(context.canvasElement)
    await expectSizes(context.canvasElement, 14)
    await expectPerServingInline(context.canvasElement)
    await expectNoInfo(context)
  },
}

/** The cook view's size. */
export const BalancedLarge: Story = {
  args: { size: 'lg' },
  play: async ({ canvasElement }) => {
    await expectPlaced(canvasElement)
    await expectSizes(canvasElement, 16)
    await expectPerServingInline(canvasElement)
  },
}

/** Carbs are 4% of the energy: the label sits just right of Protein. */
export const LowCarb: Story = {
  args: { nutrition: LOW_CARB },
  play: async ({ canvasElement }) => expectPlaced(canvasElement),
}

export const LowCarbLarge: Story = {
  args: { nutrition: LOW_CARB, size: 'lg' },
  play: async ({ canvasElement }) => expectPlaced(canvasElement),
}

/** Carbs are 68% of the energy: "104g Carbs" centres under its long part. */
export const HighCarb: Story = {
  args: { nutrition: HIGH_CARB },
  play: async ({ canvasElement }) => expectPlaced(canvasElement),
}

export const HighCarbLarge: Story = {
  args: { nutrition: HIGH_CARB, size: 'lg' },
  play: async ({ canvasElement }) => {
    await expectPlaced(canvasElement)
    const offset =
      centre(box(label(canvasElement, 'carbs'))) - centre(box(part(canvasElement, 'carbs')))
    await expect(Math.abs(offset)).toBeLessThanOrEqual(1)
  },
}

/**
 * Measured inside a transform, as the cook view's dialog is while it zooms in.
 * Client rects are scaled; the placement is a CSS length, so the hook divides
 * the scale out, and Carbs still centre under their part.
 */
export const HighCarbScaled: Story = {
  args: { nutrition: HIGH_CARB, size: 'lg' },
  decorators: [
    (Story) => (
      <div className="scale-90">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await loadFonts(canvasElement)
    await waitFor(() =>
      expect(legend(canvasElement).style.getPropertyValue('--macro-carbs-x')).toMatch(/px$/),
    )
    const offset =
      centre(box(label(canvasElement, 'carbs'))) - centre(box(part(canvasElement, 'carbs')))
    await expect(Math.abs(offset)).toBeLessThanOrEqual(1)
  },
}

/**
 * The Coconut Vegetable Curry, 10 / 48 / 38 g: 7 / 33 / 60 of the energy.
 * Carbs centre under their part unless that runs within 16px of Protein, and
 * the label starts over its own part either way. In Geist at 350px the centred
 * label clears Protein by about 18px, so the clamp is one font's width away.
 */
export const LowProtein: Story = {
  args: { nutrition: LOW_PROTEIN },
  play: async ({ canvasElement }) => expectCarbsByTheRule(canvasElement),
}

export const LowProteinLarge: Story = {
  args: { nutrition: LOW_PROTEIN, size: 'lg' },
  play: async ({ canvasElement }) => expectCarbsByTheRule(canvasElement),
}

/**
 * Carbs start where the placement rule says: centred under their part, or 16px
 * after Protein when centring would come closer, and inside their part's span.
 */
async function expectCarbsByTheRule(canvasElement: HTMLElement) {
  await expectPlaced(canvasElement)
  const protein = box(label(canvasElement, 'protein'))
  const carbs = box(label(canvasElement, 'carbs'))
  const carbsPart = box(part(canvasElement, 'carbs'))
  const expected = Math.max(protein.right + 16, centre(carbsPart) - carbs.width / 2)
  await expect(Math.abs(carbs.left - expected)).toBeLessThanOrEqual(1)
  await expect(carbs.left).toBeGreaterThanOrEqual(carbsPart.left)
  await expect(carbs.left).toBeLessThanOrEqual(carbsPart.right)
}

/** A macro at 0g has no part and no gap, and its "0g" stays in the legend, in its slot. */
export const ZeroFat: Story = {
  args: { nutrition: { calories: 300, protein: 25, carbs: 45, fat: 0 } },
  play: async ({ canvasElement }) => {
    const parts = canvasElement.querySelectorAll<HTMLElement>('[data-macro-part]')
    await expect([...parts].map((p) => p.dataset.macroPart)).toEqual(['protein', 'carbs'])
    await expect(within(canvasElement).getByText('0g')).toBeInTheDocument()
    await expectPlaced(canvasElement)
  },
}

/** Carbs at 0g centre on the boundary between the protein and fat parts. */
export const ZeroCarbs: Story = {
  args: { nutrition: { calories: 280, protein: 25, carbs: 0, fat: 20 } },
  play: async ({ canvasElement }) => {
    await expectPlaced(canvasElement)
    const boundary =
      (box(part(canvasElement, 'protein')).right + box(part(canvasElement, 'fat')).left) / 2
    await expect(
      Math.abs(centre(box(label(canvasElement, 'carbs'))) - boundary),
    ).toBeLessThanOrEqual(1)
  },
}

/** Nothing to split: no bar, and the legend still renders, without swatches. */
export const AllZero: Story = {
  args: { nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('macro-split')).not.toBeInTheDocument()
    await expectPlaced(canvasElement)
  },
}

/** "Süsivesikud" is the widest name. */
export const Estonian: Story = {
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('portsjoni kohta')).toBeInTheDocument()
    await expectPlaced(canvasElement)
  },
}

export const EstonianLarge: Story = {
  args: { size: 'lg' },
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => expectPlaced(canvasElement),
}

/**
 * Too narrow for the three labels and two 16px gaps (as at 200% text zoom):
 * a plain row that wraps, still without swatches or overlap.
 */
export const Cramped: Story = {
  globals: { locale: 'et' },
  decorators: [
    (Story) => (
      <div className="w-36">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(legend(canvasElement)).toHaveAttribute('data-fallback'))
    await expectNoSwatch(canvasElement)
    await expectNoOverlap(canvasElement)
  },
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
  args: { nutrition: FOUR_DIGIT },
  play: async ({ canvasElement }) => expectPlaced(canvasElement),
}

export const FourDigitCaloriesLarge: Story = {
  args: { nutrition: FOUR_DIGIT, size: 'lg' },
  play: async ({ canvasElement }) => expectPlaced(canvasElement),
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
