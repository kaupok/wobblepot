import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { mealHueStyle } from './MealImageCard'
import {
  askMenusArgs,
  cookQuestion,
  expectAskTooltip,
  fullTips,
  openAskMenu,
  pickFromAskMenu,
  STEP_2,
} from './PreparationSteps.fixtures'
import {
  PreparationEquipment,
  PreparationSteps,
  type CookQuestionControls,
} from './PreparationSteps'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

const meta = {
  title: 'Meal plan/PreparationSteps/Ask menus',
  component: PreparationSteps,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The cook view’s ⋯ menu on each step and each “You’ll need” item, and the question panel it opens (HON-969, HON-1350).',
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

/**
 * Step 2, the current step, sits on the chip with its ⋯ inside. Every ⋯, a
 * step's or a "You'll need" item's, ends on the column's edge (HON-1369).
 */
async function expectCurrentRow(canvasElement: HTMLElement) {
  const right = (el: Element) => Math.round(el.getBoundingClientRect().right)
  const edge = right(canvasElement.querySelector('[data-meal-surface] > *')!)
  const canvas = within(canvasElement)
  const row = canvas.getByRole('button', { name: 'Ask about step 2' }).parentElement!
  await expect(row).toHaveClass('bg-secondary')
  await expect(row.querySelector('[data-current]')).toHaveAccessibleName(/^Pat chicken/)
  for (const more of canvas.getAllByRole('button', { name: /^Ask about/ })) {
    await expect(right(more)).toBe(edge)
  }
}

/**
 * Each step with its ⋯ button beside the toggle; no panel open. It is the
 * 44px `icon-lg` button at every width (HON-1350), and hovering it shows the
 * tooltip.
 */
export const WithAskMenus: Story = {
  args: askMenusArgs,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const more = canvas.getByRole('button', { name: 'Ask about step 2' })
    await expect(more.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await expect(more.getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
    await expect(more).not.toHaveAttribute('title')
    await expectCurrentRow(canvasElement)

    await userEvent.hover(more)
    await expectAskTooltip(2)
    await userEvent.unhover(more)
    await waitFor(() =>
      expect(within(document.body).queryByRole('tooltip')).not.toBeInTheDocument(),
    )

    await pickFromAskMenu(more, 'Ask your own question')
    await expect(args.cookQuestion!.onOpenSubject).toHaveBeenCalledWith({ kind: 'step', index: 1 })
  },
}

/** Tab to step 1's ⋯ button: the tooltip opens on keyboard focus too. */
export const WithAskMenusFocus: Story = {
  name: 'With Ask menus (keyboard focus)',
  args: askMenusArgs,
  play: async ({ canvasElement }) => {
    const more = within(canvasElement).getByRole('button', { name: 'Ask about step 1' })
    // Step 1's toggle, then its ⋯ button.
    await userEvent.tab()
    await userEvent.tab()
    await expect(more).toHaveFocus()
    await expectAskTooltip(1)
  },
}

/** From `lg` the ⋯ button stays the 44px square: no visible label (HON-1350). */
export const WithAskMenusDesktop: Story = {
  name: 'With Ask menus (desktop)',
  args: askMenusArgs,
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const more = within(canvasElement).getByRole('button', { name: 'Ask about step 2' })
    const box = more.getBoundingClientRect()
    await expect(box.width).toBe(box.height)
    await expect(box.height).toBeGreaterThanOrEqual(44)
    await expectCurrentRow(canvasElement)
  },
}

/**
 * The panel open under step 2, as "Ask your own question" opens it: the
 * field and Send, then the footer row with Close, and no chips (HON-1350).
 * The field and Send are one height, the field's text is 16px, and Send,
 * Close and the open ⋯ button, filled, end on one edge (HON-1022).
 */
export const AskPanelOpen: Story = {
  args: {
    ...WithAskMenus.args,
    cookQuestion: cookQuestion({ openSubject: STEP_2 }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const panel = canvas.getByRole('group', { name: 'Ask about step 2' })
    const p = within(panel)
    const field = p.getByRole('textbox')
    const send = p.getByRole('button', { name: 'Send' })
    const close = p.getByRole('button', { name: 'Close' })
    const more = canvas.getByRole('button', { name: 'Ask about step 2' })
    const height = (el: HTMLElement) => el.getBoundingClientRect().height
    const right = (el: HTMLElement) => Math.round(el.getBoundingClientRect().right)
    await expect(p.getAllByRole('button')).toEqual([send, close])
    await expect(height(field)).toBe(height(send))
    await expect(getComputedStyle(field).fontSize).toBe('16px')
    await expect(field).toHaveAttribute('placeholder', 'Ask about this step')
    await expect(right(close)).toBe(right(send))
    await expect(right(more)).toBe(right(send))
    await expect(more).toHaveClass('bg-secondary')
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('button', { name: 'Ask about step 1' })).not.toHaveClass(
      'bg-secondary',
    )
    for (const button of p.getAllByRole('button')) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
  },
}

/**
 * "You'll need" with a ⋯ menu at the end of each row (HON-983, HON-1350),
 * named for the item. The modal's side holds one open subject, so the play
 * opens a step's panel, then item 2's, and the step's closes.
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

export const EquipmentWithAskMenus: Story = {
  args: { ...askMenusArgs, cookQuestion: cookQuestion() },
  render: (args) => <EquipmentAndStepsWithState {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expectCurrentRow(canvasElement)
    const list = canvas.getByRole('list', { name: "You'll need" })
    for (const item of fullTips.equipment!) {
      const more = within(list).getByRole('button', { name: `Ask about ${item}` })
      await expect(more.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }

    await pickFromAskMenu(
      canvas.getByRole('button', { name: 'Ask about step 2' }),
      'Ask your own question',
    )
    await expect(canvas.getByRole('group', { name: 'Ask about step 2' })).toBeVisible()

    const knife = canvas.getByRole('button', { name: 'Ask about Sharp chef’s knife' })
    const menu = await openAskMenu(knife)
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'What can I use instead?',
      'Does the size matter?',
      'Can I skip it?',
      'Ask your own question',
    ])
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'What can I use instead?' }))
    await expect(canvas.queryByRole('group', { name: 'Ask about step 2' })).toBeNull()
    await expect(knife).toHaveAttribute('aria-expanded', 'true')
    const panel = canvas.getByRole('group', { name: 'Ask about Sharp chef’s knife' })
    await expect(within(panel).getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Ask about this item',
    )
    await expect(args.cookQuestion!.ask).toHaveBeenCalledWith({
      subject: { kind: 'equipment', index: 1 },
      steps: fullTips.steps,
      equipment: fullTips.equipment,
      question: 'What can I use instead?',
      source: 'chip',
    })
    const close = within(panel).getByRole('button', { name: 'Close' })
    await waitFor(() => expect(close).toHaveFocus())

    await userEvent.click(close)
    await expect(knife).toHaveFocus()
  },
}

/** From `lg` too, the current step's chip holds its ⋯ and every ⋯ lines up (HON-1369). */
export const EquipmentWithAskMenusDesktop: Story = {
  name: 'Equipment with Ask menus (desktop)',
  args: { ...askMenusArgs, cookQuestion: cookQuestion() },
  render: (args) => <EquipmentAndStepsWithState {...args} />,
  globals: { viewport: { value: 'laptop', isRotated: false } },
  play: async ({ canvasElement }) => expectCurrentRow(canvasElement),
}

/** An item's panel answered: no numeral to indent past, so it starts at the item text. */
export const EquipmentAskAnswered: Story = {
  args: { steps: null, isLoading: false, error: null },
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
