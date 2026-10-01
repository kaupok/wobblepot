import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'
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
          'Per-serving macro summary rendered on the meal detail view. Defaults to a two-column label/value grid; the `compact` variant renders a single interpunct-separated line. When any component has `isVague: true`, an (i) button follows the heading (or the compact line); hover, tap or Enter opens a popover saying the numbers include estimates (HON-764, HON-930).',
      },
    },
  },
  args: {
    nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
  },
} satisfies Meta<typeof NutritionSummary>

export default meta
type Story = StoryObj<typeof meta>

const LABEL = 'About these numbers'
const EXPLANATION = 'Includes estimates for vague quantities like “to taste”.'

const expectNoInfo: Story['play'] = async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  await expect(canvasElement.textContent).not.toContain('*')
}

// The popover portals to the body, so it is found there. Its text is read from
// the dialog: the button's sr-only description carries the same sentence.
const expectInfo: Story['play'] = async ({ canvasElement }) => {
  await expect(canvasElement.textContent).not.toContain('*')
  await userEvent.click(within(canvasElement).getByRole('button', { name: LABEL }))
  const popover = await within(document.body).findByRole('dialog', { name: LABEL })
  await expect(within(popover).getByText(EXPLANATION)).toBeInTheDocument()
}

export const Default: Story = {
  play: expectNoInfo,
}

export const Compact: Story = {
  args: { compact: true },
  play: expectNoInfo,
}

export const WithVagueEstimates: Story = {
  args: {
    components: [{ isVague: true }, { isVague: false }],
  },
  play: expectInfo,
}

/** The compact line (cards, meal detail) carries the same (i) as the full layout (HON-930). */
export const CompactWithVagueEstimates: Story = {
  args: {
    compact: true,
    components: [{ isVague: true }],
  },
  play: expectInfo,
}

/**
 * Four-digit values exercise the locale-aware `formatInteger` path (HON-556):
 * under the Storybook locale toggle, `en` renders "1,250 kcal" while `et`
 * renders "1250 kcal" — CLDR Estonian only groups at 5+ digits ("10 000"),
 * so the absence of the en comma is the locale-correct behavior here.
 */
export const FourDigitCalories: Story = {
  args: {
    nutrition: { calories: 1250, protein: 95, carbs: 130, fat: 48 },
  },
}
