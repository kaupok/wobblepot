import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

import { mealHueStyle } from './MealImageCard'
import { type CookQuestionControls, PreparationSteps } from './PreparationSteps'
import {
  askMenusArgs,
  cookQuestion,
  expectAskTooltip,
  pickFromAskMenu,
  STEP_2,
} from './PreparationSteps.fixtures'

const meta = {
  title: 'Meal plan/PreparationSteps/Ask answers',
  component: PreparationSteps,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The question panel’s answer states: pending, streamed, answered, failed, and the echo and focus moves around them (HON-969, HON-1022).',
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

export const AskPending: Story = {
  args: {
    ...askMenusArgs,
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
    // "Thinking…" holds the pencil's place in the card's top row, before ×,
    // so the wait adds no line (HON-978, HON-1371).
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const thinking = within(card).getByText('Thinking…', { selector: 'p' })
    const close = canvas.getByRole('button', { name: 'Close' })
    const box = (el: Element) => el.getBoundingClientRect()
    await expect(box(thinking).right).toBeLessThanOrEqual(box(close).left)
    await expect(box(thinking).bottom).toBeLessThanOrEqual(box(close).bottom)
    await expect(box(thinking).top).toBeGreaterThanOrEqual(box(close).top)
    await expect(canvas.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask a follow-up')
    await expect(canvas.getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

export const AskAnswered: Story = {
  args: {
    ...askMenusArgs,
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
    const asked = canvas.getByText('You asked: What can I substitute here?')
    await expect(asked).toBeVisible()
    // The question, the pencil and the × in the card's top row (HON-1371).
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const edit = canvas.getByRole('button', { name: 'Edit question' })
    const close = canvas.getByRole('button', { name: 'Close' })
    const box = (el: Element) => el.getBoundingClientRect()
    await expect(edit).toBeVisible()
    await expect(box(close).top).toBe(box(edit).top)
    await expect(Math.round(box(card).right - box(close).right)).toBe(12)
    // The answer and the follow-up row sit inside the card, the answer one
    // size below the step text, and the card ends before the next step.
    const answer = canvas.getByText(/^No garlic\?/)
    await expect(card).toContainElement(answer)
    await expect(card).toContainElement(canvas.getByRole('button', { name: 'Send' }))
    await expect(parseFloat(getComputedStyle(answer).fontSize)).toBeLessThan(
      parseFloat(getComputedStyle(canvas.getByText(/^Pat chicken/)).fontSize),
    )
    await expect(getComputedStyle(card).borderTopWidth).toBe('0px')
    const nextStep = canvas.getByRole('button', { name: /^Toss with olive oil/ })
    await expect(box(nextStep).top).toBeGreaterThan(box(card).bottom)
    for (const button of [edit, close]) {
      await expect(box(button).height).toBeGreaterThanOrEqual(44)
      await expect(box(button).width).toBeGreaterThanOrEqual(44)
    }
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
    ...askMenusArgs,
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
 * answer, and Send stays disabled until the stream closes.
 */
export const AskStreaming: Story = {
  args: {
    ...askMenusArgs,
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
  },
}

/**
 * The stream broke after its first words (HON-979): the words stay, with the
 * generic error and Retry under them.
 */
export const AskStreamBroke: Story = {
  args: {
    ...askMenusArgs,
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
    ...askMenusArgs,
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
    ...askMenusArgs,
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
 * The modal's side of the contract with state, so a ready-made question
 * shows: a send sets the active question for that step, as
 * `useCookQuestion` does, its answer arrives 300ms later, and opening or
 * closing a panel drops it.
 */
function AskWithState(args: React.ComponentProps<typeof PreparationSteps>) {
  const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(null)
  const [active, setActive] = useState<CookQuestionControls['active']>(null)
  const controls = args.cookQuestion!
  return (
    <PreparationSteps
      {...args}
      cookQuestion={{
        ...controls,
        openSubject,
        onOpenSubject: (subject) => {
          setActive(null)
          setOpenSubject(subject)
        },
        onClose: () => {
          setActive(null)
          setOpenSubject(null)
        },
        active,
        isPending: active !== null && active.answer === null,
        ask: (input) => {
          controls.ask(input)
          setActive({ subject: input.subject, question: input.question, answer: null })
          setTimeout(
            () =>
              setActive(
                (current) => current && { ...current, answer: 'Roast at 240°C and check at 25.' },
              ),
            300,
          )
        },
      }}
    />
  )
}

/**
 * HON-976: a ready-made question from the ⋯ menu shows beside "Thinking…",
 * and once the answer is in, the pencil Edit puts it back in the field with
 * focus, without sending it again. The pick moves focus to the × Close
 * (HON-1350, HON-1371).
 */
export const AskEchoAndEdit: Story = {
  args: {
    ...askMenusArgs,
    cookQuestion: cookQuestion(),
  },
  render: (args) => <AskWithState {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await pickFromAskMenu(
      canvas.getByRole('button', { name: 'Ask about step 2' }),
      "I'm short on time",
    )
    const panel = canvas.getByRole('group', { name: 'Ask about step 2' })
    await expect(within(panel).getByText("You asked: I'm short on time")).toBeVisible()
    await expect(within(panel).getByRole('status')).toHaveTextContent('Thinking…')
    // Focus waits on Close, not the trigger and not the field, which would
    // open a phone's keyboard.
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Close' })).toHaveFocus())

    // The pencil comes back once the answer is in.
    await within(panel).findByText('Roast at 240°C and check at 25.')
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit question' }))
    const field = within(panel).getByRole('textbox', { name: 'Your question' })
    await expect(field).toHaveValue("I'm short on time")
    await expect(field).toHaveFocus()
    await expect(args.cookQuestion!.ask).toHaveBeenCalledOnce()
  },
}

/**
 * "Ask your own question" focuses the field. Closing the panel hands focus
 * back to the step's ⋯ button. After a tap or a click on Close that focus
 * opens no tooltip, which would cover the step until the next tap; after
 * Escape from the keyboard it does, as Tab does (HON-981).
 */
export const AskCloseReturnsFocus: Story = {
  args: {
    ...askMenusArgs,
    cookQuestion: cookQuestion(),
  },
  render: (args) => <AskWithState {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const more = canvas.getByRole('button', { name: 'Ask about step 2' })
    const panelOf = () => canvas.getByRole('group', { name: 'Ask about step 2' })
    // Give a wrongly opened tooltip its frame to mount before checking.
    const expectNoTooltip = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await expect(within(document.body).queryByRole('tooltip')).not.toBeInTheDocument()
    }

    await pickFromAskMenu(more, 'Ask your own question')
    await waitFor(() => expect(within(panelOf()).getByRole('textbox')).toHaveFocus())
    await userEvent.click(within(panelOf()).getByRole('button', { name: 'Close' }))
    await expect(canvas.queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await expect(more).toHaveFocus()
    await expectNoTooltip()

    await pickFromAskMenu(more, 'Ask your own question')
    const field = within(panelOf()).getByRole('textbox')
    await waitFor(() => expect(field).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await expect(more).toHaveFocus()
    await expectAskTooltip(2)
  },
}
