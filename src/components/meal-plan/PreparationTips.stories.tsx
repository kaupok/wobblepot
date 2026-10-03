import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'
import { mealHueStyle } from './MealImageCard'
import {
  PreparationEquipment,
  PreparationSteps,
  type CookQuestionControls,
} from './PreparationTips'
import type { StructuredTips } from './types'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

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

const STEP_2: CookQuestionSubject = { kind: 'step', index: 1 }

/** The cook-question controls as `MealDetailModal` passes them, with spies (HON-969). */
function cookQuestion(overrides: Partial<CookQuestionControls> = {}): CookQuestionControls {
  return {
    openSubject: null,
    onOpenSubject: fn(),
    onClose: fn(),
    ask: fn(),
    active: null,
    previous: null,
    isPending: false,
    isStreaming: false,
    error: null,
    onRetry: fn(),
    ...overrides,
  }
}

const askButtonsArgs = {
  tips: fullTips,
  isLoading: false,
  error: null,
  doneSteps: new Set([0]),
  onToggleStep: fn(),
  cookQuestion: cookQuestion(),
}

/** The shadcn tooltip names the step; it is portalled to the body. */
async function expectAskTooltip(n: number) {
  const tooltip = await within(document.body).findByRole('tooltip')
  await expect(tooltip).toHaveTextContent(`Ask about step ${n}`)
  // The cook view keeps text at 16px or above, the tooltip included.
  const content = document.querySelector('[data-slot="tooltip-content"]')!
  await expect(getComputedStyle(content).fontSize).toBe('16px')
}

/**
 * Each step with its Ask button beside the toggle; no panel open. On a phone
 * the button is the 44px icon alone, with a heavier stroke (HON-981), and
 * hovering it shows the tooltip.
 */
export const WithAskButtons: Story = {
  args: askButtonsArgs,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const ask = canvas.getByRole('button', { name: 'Ask about step 2' })
    await expect(ask.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await expect(ask.getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
    await expect(within(ask).getByText('Ask')).not.toBeVisible()
    await expect(ask.querySelector('svg')).toHaveAttribute('stroke-width', '2.25')
    await expect(ask).not.toHaveAttribute('title')

    await userEvent.hover(ask)
    await expectAskTooltip(2)
    await userEvent.unhover(ask)
    await waitFor(() =>
      expect(within(document.body).queryByRole('tooltip')).not.toBeInTheDocument(),
    )

    await userEvent.click(ask)
    await expect(args.cookQuestion!.onOpenSubject).toHaveBeenCalledWith({ kind: 'step', index: 1 })
  },
}

/** Tab to step 1's Ask button: the tooltip opens on keyboard focus too. */
export const WithAskButtonsFocus: Story = {
  name: 'With Ask buttons (keyboard focus)',
  args: askButtonsArgs,
  play: async ({ canvasElement }) => {
    const ask = within(canvasElement).getByRole('button', { name: 'Ask about step 1' })
    // Step 1's toggle, then its Ask button.
    await userEvent.tab()
    await userEvent.tab()
    await expect(ask).toHaveFocus()
    await expectAskTooltip(1)
  },
}

/**
 * From `lg` the row is wide enough for the visible label: each step ends in a
 * ghost button that reads "Ask" beside the icon (HON-981).
 */
export const WithAskButtonsDesktop: Story = {
  name: 'With Ask buttons (desktop)',
  args: askButtonsArgs,
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const ask = within(canvasElement).getByRole('button', { name: 'Ask about step 2' })
    await expect(within(ask).getByText('Ask')).toBeVisible()
    const box = ask.getBoundingClientRect()
    await expect(box.width).toBeGreaterThan(box.height)
    await expect(box.height).toBeGreaterThanOrEqual(44)
  },
}

/**
 * The panel open under step 2: three chips, then the field and Send, then the
 * footer row with Close. The chips, the field and Send are one height, the
 * field's text is 16px, and Send, Close and the open Ask button, filled, end
 * on one edge (HON-1022).
 */
export const AskPanelOpen: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({ openSubject: STEP_2 }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const panel = canvas.getByRole('group', { name: 'Ask about step 2' })
    const p = within(panel)
    const field = p.getByRole('textbox')
    const send = p.getByRole('button', { name: 'Send' })
    const close = p.getByRole('button', { name: 'Close' })
    const ask = canvas.getByRole('button', { name: 'Ask about step 2' })
    const height = (el: HTMLElement) => el.getBoundingClientRect().height
    const right = (el: HTMLElement) => Math.round(el.getBoundingClientRect().right)
    for (const chip of p.getAllByRole('button', { name: /\?$|time$/ })) {
      await expect(height(chip)).toBe(height(send))
    }
    await expect(height(field)).toBe(height(send))
    await expect(getComputedStyle(field).fontSize).toBe('16px')
    await expect(right(close)).toBe(right(send))
    await expect(right(ask)).toBe(right(send))
    await expect(ask).toHaveClass('bg-secondary')
    await expect(canvas.getByRole('button', { name: 'Ask about step 1' })).not.toHaveClass(
      'bg-secondary',
    )
    await userEvent.click(within(panel).getByRole('button', { name: "How do I know it's done?" }))
    await expect(args.cookQuestion!.ask).toHaveBeenCalledWith({
      subject: STEP_2,
      steps: fullTips.steps,
      equipment: fullTips.equipment,
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
      openSubject: STEP_2,
      isPending: true,
      active: { subject: STEP_2, question: "How do I know it's done?", answer: null },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The question stays on screen above "Thinking…" (HON-976).
    await expect(canvas.getByText("You asked: How do I know it's done?")).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('Thinking…')
    // "Thinking…" shares the footer row and leaves Close at Send's edge (HON-1022).
    const right = (el: HTMLElement) => Math.round(el.getBoundingClientRect().right)
    await expect(right(canvas.getByRole('button', { name: 'Close' }))).toBe(
      right(canvas.getByRole('button', { name: 'Send' })),
    )
    await expect(canvas.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask a follow-up')
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
      openSubject: STEP_2,
      active: {
        subject: STEP_2,
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

/**
 * A second question on its way (HON-978): the first answer stays, muted,
 * under its own question, with "Thinking…" below it, so the panel keeps its
 * height until the new answer takes that place.
 */
export const AskPendingWithPrevious: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openSubject: STEP_2,
      isPending: true,
      active: { subject: STEP_2, question: "I'm short on time", answer: null },
      previous: {
        subject: STEP_2,
        question: 'What can I substitute here?',
        answer:
          'No garlic? Use the onion you have, sliced thin, for the same base. Add it with the lemon so it softens in the pan juices.',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const status = canvas.getByRole('status')
    await expect(within(status).getByText(/^No garlic\?/)).toHaveClass('text-muted-foreground')
    await expect(status).toHaveTextContent(/Thinking…$/)
    await expect(canvas.getByText('You asked: What can I substitute here?')).toBeVisible()
  },
}

/**
 * The answer's first words have arrived and the rest is on its way (HON-979):
 * no "Thinking…", the status is busy so a screen reader waits for the whole
 * answer, and Send and the chips stay disabled until the stream closes.
 */
export const AskStreaming: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openSubject: STEP_2,
      isStreaming: true,
      active: {
        subject: STEP_2,
        question: 'What can I substitute here?',
        answer: 'No garlic? Use the onion you have, sliced thin,',
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement).getByRole('group', { name: 'Ask about step 2' })
    const status = within(panel).getByRole('status')
    await expect(status).toHaveAttribute('aria-busy', 'true')
    await expect(status).not.toHaveTextContent('Thinking…')
    await expect(within(status).getByText(/^No garlic\?/)).not.toHaveClass('text-muted-foreground')
    await expect(within(panel).getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    // The chips gave way to the question once it went out (HON-1022).
    await expect(within(panel).queryByRole('button', { name: "I'm short on time" })).toBeNull()
  },
}

/**
 * The stream broke after its first words (HON-979): the words stay, with the
 * generic error and Retry under them.
 */
export const AskStreamBroke: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openSubject: STEP_2,
      active: {
        subject: STEP_2,
        question: 'What can I substitute here?',
        answer: 'No garlic? Use the onion you have, sliced thin,',
      },
      error: { message: "Couldn't get an answer. Please try again.", canRetry: true },
    }),
  },
  play: async ({ canvasElement }) => {
    const status = within(canvasElement).getByRole('status')
    const words = within(status).getByText(/^No garlic\?/)
    const error = within(status).getByText("Couldn't get an answer. Please try again.")
    await expect(
      words.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect(within(canvasElement).getByRole('button', { name: 'Retry' })).toBeVisible()
  },
}

/** A timeout: catalog copy, and Retry because a second try can help. */
export const AskError: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion({
      openSubject: STEP_2,
      active: { subject: STEP_2, question: "I'm short on time", answer: null },
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
      openSubject: STEP_2,
      active: { subject: STEP_2, question: "I'm short on time", answer: null },
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
  const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(STEP_2)
  const [active, setActive] = useState<CookQuestionControls['active']>(null)
  const controls = args.cookQuestion!
  return (
    <PreparationSteps
      {...args}
      cookQuestion={{
        ...controls,
        openSubject,
        onOpenSubject: setOpenSubject,
        onClose: () => setOpenSubject(null),
        active,
        isPending: active !== null,
        ask: (input) => {
          controls.ask(input)
          setActive({ subject: input.subject, question: input.question, answer: null })
        },
      }}
    />
  )
}

/**
 * HON-976: a chip's question shows above "Thinking…", and Edit puts it back
 * in the field with focus, without sending it again. The chip moves focus to
 * Close as the chips go (HON-1022).
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
    // The chip unmounted with the others; focus waits on Close, not the page
    // and not the field, which would open a phone's keyboard (HON-1022).
    await expect(within(panel).queryByRole('button', { name: "I'm short on time" })).toBeNull()
    await expect(within(panel).getByRole('button', { name: 'Close' })).toHaveFocus()

    await userEvent.click(within(panel).getByRole('button', { name: 'Edit' }))
    const field = within(panel).getByRole('textbox', { name: 'Your question' })
    await expect(field).toHaveValue("I'm short on time")
    await expect(field).toHaveFocus()
    await expect(args.cookQuestion!.ask).toHaveBeenCalledOnce()
  },
}

/**
 * Closing a panel hands focus back to the step's Ask button. After a tap or a
 * click on Close, or a Safari tap on Ask itself, that focus opens no tooltip,
 * which would cover the step until the next tap; after Escape from the
 * keyboard it does, as Tab does (HON-981).
 */
export const AskCloseReturnsFocus: Story = {
  args: {
    ...WithAskButtons.args,
    cookQuestion: cookQuestion(),
  },
  render: (args) => <AskWithState {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ask = canvas.getByRole('button', { name: 'Ask about step 2' })
    const panelOf = () => canvas.getByRole('group', { name: 'Ask about step 2' })
    // Give a wrongly opened tooltip its frame to mount before checking.
    const expectNoTooltip = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await expect(within(document.body).queryByRole('tooltip')).not.toBeInTheDocument()
    }

    // A tap on Ask in Safari clicks it without focusing it, so closing the
    // panel that way moves focus to it afresh.
    fireEvent.click(ask)
    await expect(canvas.queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await expect(ask).toHaveFocus()
    await expectNoTooltip()

    await userEvent.click(ask)
    await userEvent.click(within(panelOf()).getByRole('button', { name: 'Close' }))
    await expect(ask).toHaveFocus()
    await expectNoTooltip()

    await userEvent.click(ask)
    const field = within(panelOf()).getByRole('textbox')
    await userEvent.click(field)
    await userEvent.keyboard('{Escape}')
    await expect(ask).toHaveFocus()
    await expectAskTooltip(2)
  },
}

/**
 * "You'll need" with an Ask button at the end of each row (HON-983), named
 * for the item. The modal's side holds one open subject, so the play opens a
 * step's panel, then item 2's, and the step's closes.
 */
function EquipmentAndStepsWithState(args: React.ComponentProps<typeof PreparationSteps>) {
  const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(null)
  const controls: CookQuestionControls = {
    ...args.cookQuestion!,
    openSubject,
    onOpenSubject: setOpenSubject,
    onClose: () => setOpenSubject(null),
  }
  return (
    <div className="flex flex-col gap-6">
      <PreparationEquipment
        equipment={fullTips.equipment}
        steps={fullTips.steps}
        cookQuestion={controls}
      />
      <PreparationSteps {...args} cookQuestion={controls} />
    </div>
  )
}

export const EquipmentWithAskButtons: Story = {
  args: { ...askButtonsArgs, cookQuestion: cookQuestion() },
  render: (args) => <EquipmentAndStepsWithState {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: "You'll need" })
    for (const item of fullTips.equipment!) {
      const ask = within(list).getByRole('button', { name: `Ask about ${item}` })
      await expect(ask.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }

    await userEvent.click(canvas.getByRole('button', { name: 'Ask about step 2' }))
    await expect(canvas.getByRole('group', { name: 'Ask about step 2' })).toBeVisible()

    const knife = canvas.getByRole('button', { name: 'Ask about Sharp chef’s knife' })
    await userEvent.click(knife)
    await expect(canvas.queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await expect(knife).toHaveAttribute('aria-expanded', 'true')
    const panel = canvas.getByRole('group', { name: 'Ask about Sharp chef’s knife' })
    await expect(within(panel).getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Ask about this item',
    )
    await userEvent.click(within(panel).getByRole('button', { name: 'What can I use instead?' }))
    await expect(args.cookQuestion!.ask).toHaveBeenCalledWith({
      subject: { kind: 'equipment', index: 1 },
      steps: fullTips.steps,
      equipment: fullTips.equipment,
      question: 'What can I use instead?',
      source: 'chip',
    })

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    await expect(knife).toHaveFocus()
  },
}

/** An item's panel answered: no numeral to indent past, so it starts at the item text. */
export const EquipmentAskAnswered: Story = {
  args: { tips: null, isLoading: false, error: null },
  render: () => (
    <PreparationEquipment
      equipment={fullTips.equipment}
      steps={fullTips.steps}
      cookQuestion={cookQuestion({
        openSubject: { kind: 'equipment', index: 0 },
        active: {
          subject: { kind: 'equipment', index: 0 },
          question: 'What can I use instead?',
          answer:
            'A large oven-safe frying pan works for step 3; roast in two batches so the chicken browns, and add 5 minutes to step 4.',
        },
      })}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const panel = canvas.getByRole('group', { name: 'Ask about Sheet pan' })
    const item = canvas.getByText('Sheet pan')
    await expect(panel.getBoundingClientRect().left).toBe(item.getBoundingClientRect().left)
    await expect(within(panel).getByText('You asked: What can I use instead?')).toBeVisible()
  },
}
