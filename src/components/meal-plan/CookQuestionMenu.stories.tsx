import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CookQuestionMenu } from './CookQuestionMenu'

const meta = {
  title: 'Meal plan/CookQuestionMenu',
  component: CookQuestionMenu,
  args: {
    ref: null,
    label: 'Ask about step 2',
    kind: 'step',
    open: false,
    busy: false,
    panelId: 'panel-2',
    quietFocus: { current: false },
    onAsk: fn(),
    onAskOwn: fn(),
    onFocusPanel: fn(),
  },
} satisfies Meta<typeof CookQuestionMenu>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** The ⋯ button alone: ghost, 44px or more, named for the step (HON-1350). */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const more = within(canvasElement).getByRole('button', { name: 'Ask about step 2' })
    await expect(more.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    await expect(more).toHaveAttribute('aria-expanded', 'false')
  },
}

/** The row's panel is open: the button is expanded and stays ghost (HON-1371). */
export const PanelOpen: Story = {
  args: { open: true },
  play: async ({ canvasElement }) => {
    const more = within(canvasElement).getByRole('button', { name: 'Ask about step 2' })
    await expect(more).toHaveAttribute('data-variant', 'ghost')
    await expect(more).not.toHaveClass('bg-secondary')
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(more).toHaveAttribute('aria-controls', 'panel-2')
  },
}

/**
 * A step's menu: three ready-made questions, a separator, then "Ask your own
 * question". A ready-made question goes to `onAsk` and asks for Close's focus.
 * Each item is 16px text in a row of 44px or more (HON-1359).
 */
export const StepMenu: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Ask about step 2' }))
    const menu = await body().findByRole('menu')
    await expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      "How do I know it's done?",
      'What can I substitute here?',
      "I'm short on time",
      'Ask your own question',
    ])
    for (const item of within(menu).getAllByRole('menuitem')) {
      // `offsetHeight`, not the rect: the menu scales in from 95%.
      await expect(item.offsetHeight).toBeGreaterThanOrEqual(44)
      await expect(getComputedStyle(item).fontSize).toBe('16px')
    }
    await userEvent.click(within(menu).getByRole('menuitem', { name: "I'm short on time" }))
    await expect(args.onAsk).toHaveBeenCalledWith("I'm short on time")
    await waitFor(() => expect(args.onFocusPanel).toHaveBeenCalledWith('close'))
  },
}

/** An item's menu in "You'll need", left open: the item's own ready-made questions. */
export const EquipmentMenu: Story = {
  args: { label: 'Ask about Sheet pan', kind: 'equipment' },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Ask about Sheet pan' }),
    )
    const menu = await body().findByRole('menu')
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
    for (const item of within(menu).getAllByRole('menuitem')) {
      // `offsetHeight`, not the rect: the menu scales in from 95%.
      await expect(item.offsetHeight).toBeGreaterThanOrEqual(44)
      await expect(getComputedStyle(item).fontSize).toBe('16px')
    }
  },
}

/** "Ask your own question" opens the panel and asks for the field's focus. */
export const AskOwn: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Ask about step 2' }))
    await userEvent.click(await body().findByRole('menuitem', { name: 'Ask your own question' }))
    await expect(args.onAskOwn).toHaveBeenCalledOnce()
    await expect(args.onAsk).not.toHaveBeenCalled()
    await waitFor(() => expect(args.onFocusPanel).toHaveBeenCalledWith('field'))
  },
}

/**
 * The row's answer is on its way: every item is disabled, so a second pick
 * cannot bill a second call (HON-1360). "Ask your own question" would reset the
 * panel and abort the answer, so it is disabled too (HON-1442).
 */
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Ask about step 2' }))
    const menu = await body().findByRole('menu')
    const item = (name: string) => within(menu).getByRole('menuitem', { name })
    const ready = ["How do I know it's done?", 'What can I substitute here?', "I'm short on time"]
    for (const name of ready) await expect(item(name)).toHaveAttribute('data-disabled')
    await expect(item('Ask your own question')).toHaveAttribute('data-disabled')
    await userEvent.click(item("I'm short on time"), { pointerEventsCheck: 0 })
    await userEvent.click(item('Ask your own question'), { pointerEventsCheck: 0 })
    await expect(args.onAsk).not.toHaveBeenCalled()
    await expect(args.onAskOwn).not.toHaveBeenCalled()
  },
}
