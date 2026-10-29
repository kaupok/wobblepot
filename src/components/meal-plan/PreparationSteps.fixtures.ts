import { expect, fn, userEvent, within } from 'storybook/test'

import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

import type { CookQuestionControls } from './PreparationSteps'
import type { PreparationSteps as PreparationStepsData } from './types'

/** Shared by the `PreparationSteps` story files: one meal's steps. */
export const fullTips: PreparationStepsData = {
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

export const STEP_2: CookQuestionSubject = { kind: 'step', index: 1 }

/** The cook-question controls as `MealDetailModal` passes them, with spies (HON-969). */
export function cookQuestion(overrides: Partial<CookQuestionControls> = {}): CookQuestionControls {
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

export const askMenusArgs = {
  steps: fullTips,
  isLoading: false,
  error: null,
  doneSteps: new Set([0]),
  onToggleStep: fn(),
  cookQuestion: cookQuestion(),
}

/** The shadcn tooltip names the step; it is portalled to the body. */
export async function expectAskTooltip(n: number) {
  const tooltip = await within(document.body).findByRole('tooltip')
  await expect(tooltip).toHaveTextContent(`Ask about step ${n}`)
  // The cook view keeps text at 16px or above, the tooltip included.
  const content = document.querySelector('[data-slot="tooltip-content"]')!
  await expect(getComputedStyle(content).fontSize).toBe('16px')
}

/** The menu is portalled to the body; open it from the row's ⋯ button. */
export async function openAskMenu(button: HTMLElement) {
  await userEvent.click(button)
  return within(document.body).findByRole('menu')
}

/** Choose an item in the row's ⋯ menu (HON-1350). */
export async function pickFromAskMenu(button: HTMLElement, item: string) {
  const menu = await openAskMenu(button)
  await userEvent.click(within(menu).getByRole('menuitem', { name: item }))
}
