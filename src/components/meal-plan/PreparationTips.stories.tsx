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
          'The cook view’s steps area (HON-932): the household’s notes, then numbered steps, Watch out and Tip at the step size, straight on the meal’s tint. `PreparationEquipment` is the “You’ll need” list that sits under the ingredients instead, one item per row at the ingredient rows’ 18px.',
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

/** One row per item at the ingredient rows' 18px, under a Section heading (HON-952). */
export const Equipment: Story = {
  args: { tips: null, isLoading: false, error: null },
  render: () => <PreparationEquipment equipment={fullTips.equipment} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: "You'll need" })).toBeVisible()
    const items = within(canvas.getByRole('list', { name: "You'll need" })).getAllByRole('listitem')
    await expect(items).toHaveLength(fullTips.equipment!.length)
    for (const item of items) await expect(getComputedStyle(item).fontSize).toBe('18px')
  },
}

/** The long, parenthesised items the model writes (staging, Beef and Broccoli): each wraps on its own row. */
const longEquipment = [
  'Two large 36cm flat-bottom woks or heavy skillets (to cook in batches over high heat)',
  'Large stockpot or 10L bowl with ice bath for blanching broccoli',
  'Sharp chef’s knife and two large cutting boards',
]

export const EquipmentLongItems: Story = {
  args: { tips: null, isLoading: false, error: null },
  render: () => <PreparationEquipment equipment={longEquipment} />,
  play: async ({ canvasElement }) => {
    const items = within(within(canvasElement).getByRole('list')).getAllByRole('listitem')
    await expect(items.map((item) => item.textContent)).toEqual(longEquipment)
  },
}

export const Loading: Story = {
  args: {
    tips: null,
    isLoading: true,
    error: null,
  },
  play: async ({ canvasElement }) => {
    // A generation takes up to 45s: the skeletons come with a line saying so (HON-933).
    await expect(within(canvasElement).getByText('Writing the steps…')).toBeVisible()
  },
}

/**
 * The steps as toggles (HON-933): two done (check, muted), the third the
 * current one on the chip, the last still to come.
 */
export const WithProgress: Story = {
  args: {
    tips: fullTips,
    isLoading: false,
    error: null,
    doneSteps: new Set([0, 1]),
    onToggleStep: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const step = (i: number) => canvas.getByRole('button', { name: fullTips.steps![i]! })
    await expect(step(0)).toHaveAttribute('aria-pressed', 'true')
    await expect(step(2)).toHaveAttribute('data-current')
    await expect(step(2).getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    step(3).click()
    await expect(args.onToggleStep).toHaveBeenCalledWith(3)
  },
}

export const WithProgressDark: Story = {
  ...WithProgress,
  globals: { theme: 'dark' },
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
