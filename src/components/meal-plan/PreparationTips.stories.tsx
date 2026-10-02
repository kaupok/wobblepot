import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { mealHueStyle } from './MealImageCard'
import {
  PreparationEquipment,
  PreparationSteps,
  type CookQuestionControls,
} from './PreparationTips'
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

/** The cook-question controls as `MealDetailModal` passes them, with spies (HON-969). */
function cookQuestion(overrides: Partial<CookQuestionControls> = {}): CookQuestionControls {
  return {
    openStep: null,
    onOpenStep: fn(),
    onClose: fn(),
    ask: fn(),
    active: null,
    isPending: false,
    error: null,
    onRetry: fn(),
    ...overrides,
  }
}

/** Each step with its 44px Ask button beside the toggle; no panel open. */
export const WithAskButtons: Story = {
  args: {
    tips: fullTips,
    isLoading: false,
    error: null,
    doneSteps: new Set([0]),
    onToggleStep: fn(),
    cookQuestion: cookQuestion(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const ask = canvas.getByRole('button', { name: 'Ask about step 2' })
    await expect(ask.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await expect(ask.getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
    await userEvent.click(ask)
    await expect(args.cookQuestion!.onOpenStep).toHaveBeenCalledWith(1)
  },
}

/** The panel open under step 2: three chips, then the field and Send. */
export const AskPanelOpen: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({ openStep: 1 }),
  },
  play: async ({ canvasElement, args }) => {
    const panel = within(canvasElement).getByRole('group', { name: 'Ask about step 2' })
    await userEvent.click(within(panel).getByRole('button', { name: "How do I know it's done?" }))
    await expect(args.cookQuestion!.ask).toHaveBeenCalledWith({
      stepIndex: 1,
      steps: fullTips.steps,
      question: "How do I know it's done?",
      source: 'chip',
    })
    for (const button of within(panel).getAllByRole('button')) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  },
}

export const AskPending: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openStep: 1,
      isPending: true,
      active: { stepIndex: 1, question: "How do I know it's done?", answer: null },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The question stays on screen above "Thinking…" (HON-976).
    await expect(canvas.getByText("You asked: How do I know it's done?")).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('Thinking…')
    await expect(canvas.getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

export const AskAnswered: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openStep: 1,
      active: {
        stepIndex: 1,
        question: 'What can I substitute here?',
        answer:
          'No garlic? Use the onion you have, sliced thin, for the same base. Add it with the lemon so it softens in the pan juices.',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('You asked: What can I substitute here?')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Edit' })).toBeVisible()
  },
}

export const AskAnsweredDark: Story = {
  ...AskAnswered,
  globals: { theme: 'dark' },
}

/** A timeout: catalog copy, and Retry because a second try can help. */
export const AskError: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openStep: 1,
      active: { stepIndex: 1, question: "I'm short on time", answer: null },
      error: { message: 'The answer took too long. Please try again.', canRetry: true },
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("You asked: I'm short on time")).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    await expect(args.cookQuestion!.onRetry).toHaveBeenCalledOnce()
  },
}

/** The hourly limit: catalog copy, and no Retry, which would only hit it again. */
export const AskRateLimited: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openStep: 1,
      active: { stepIndex: 1, question: "I'm short on time", answer: null },
      error: {
        message: "You've reached this hour's limit for questions. Please try again later.",
        canRetry: false,
      },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: 'Retry' })).toBeNull()
  },
}

/**
 * The modal's side of the contract with state, so a chip's question shows: a
 * send sets the active question for that step, as `useCookQuestion` does.
 */
function AskWithState(args: React.ComponentProps<typeof PreparationSteps>) {
  const [openStep, setOpenStep] = useState<number | null>(1)
  const [active, setActive] = useState<CookQuestionControls['active']>(null)
  const controls = args.cookQuestion!
  return (
    <PreparationSteps
      {...args}
      cookQuestion={{
        ...controls,
        openStep,
        onOpenStep: setOpenStep,
        onClose: () => setOpenStep(null),
        active,
        isPending: active !== null,
        ask: (input) => {
          controls.ask(input)
          setActive({ stepIndex: input.stepIndex, question: input.question, answer: null })
        },
      }}
    />
  )
}

/**
 * HON-976: a chip's question shows above "Thinking…", and Edit puts it back
 * in the field with focus, without sending it again.
 */
export const AskEchoAndEdit: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion(),
  },
  render: (args) => <AskWithState {...args} />,
  play: async ({ canvasElement, args }) => {
    const panel = within(canvasElement).getByRole('group', { name: 'Ask about step 2' })
    await userEvent.click(within(panel).getByRole('button', { name: "I'm short on time" }))
    await expect(within(panel).getByText("You asked: I'm short on time")).toBeVisible()
    await expect(within(panel).getByRole('status')).toHaveTextContent('Thinking…')

    await userEvent.click(within(panel).getByRole('button', { name: 'Edit' }))
    const field = within(panel).getByRole('textbox', { name: 'Your question' })
    await expect(field).toHaveValue("I'm short on time")
    await expect(field).toHaveFocus()
    await expect(args.cookQuestion!.ask).toHaveBeenCalledOnce()
  },
}
