import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
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
          'Per-serving macro summary rendered on the meal detail view. Defaults to a two-column label/value grid; the `compact` variant renders a single interpunct-separated line. When any component has `isVague: true`, a `*` is appended to the heading (or the compact line) and the footnote explaining it is shown below, in both layouts (HON-764).',
      },
    },
  },
  args: {
    nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
  },
} satisfies Meta<typeof NutritionSummary>

export default meta
type Story = StoryObj<typeof meta>

const FOOTNOTE = '*includes estimates for vague quantities'

const expectNoFootnote: Story['play'] = async ({ canvasElement }) => {
  await expect(within(canvasElement).queryByText(FOOTNOTE)).not.toBeInTheDocument()
  await expect(canvasElement.textContent).not.toContain('*')
}

const expectFootnote: Story['play'] = async ({ canvasElement }) => {
  await expect(within(canvasElement).getByText(FOOTNOTE)).toBeInTheDocument()
}

export const Default: Story = {
  play: expectNoFootnote,
}

export const Compact: Story = {
  args: { compact: true },
  play: expectNoFootnote,
}

export const WithVagueEstimates: Story = {
  args: {
    components: [{ isVague: true }, { isVague: false }],
  },
  play: expectFootnote,
}

/** The asterisk on the compact line (cards, meal detail) carries its own footnote (HON-764). */
export const CompactWithVagueEstimates: Story = {
  args: {
    compact: true,
    components: [{ isVague: true }],
  },
  play: expectFootnote,
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
