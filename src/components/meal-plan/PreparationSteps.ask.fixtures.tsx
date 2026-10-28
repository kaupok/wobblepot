import { useState } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreparationSteps, type CookQuestionControls } from './PreparationSteps'
import type { PreparationSteps as PreparationStepsData } from '@/components/meal-plan/types'
import type { CookQuestionSubject } from '@/lib/ai/cook-question-subject'

// Shared by the PreparationSteps tests. The steps' cook question tests are
// split across PreparationSteps.ask.test.tsx and .ask-panel.test.tsx.

export const sampleTips: PreparationStepsData = {
  equipment: ['Large pan', 'Cutting board'],
  steps: ['Chop vegetables', 'Heat oil in pan', 'Cook for 10 minutes'],
  pitfalls: ['Do not overcook the chicken', 'Season before cooking'],
  tip: 'Let the meat rest for 5 minutes before serving.',
}

// The × and the pencil are named by `aria-label`; the rest by their text.
export const buttonName = (b: HTMLElement) => b.getAttribute('aria-label') ?? b.textContent

/** Open a row's ⋯ menu and choose one of its items (HON-1350). */
export async function pick(menuButton: HTMLElement, item: string) {
  await userEvent.click(menuButton)
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
}

/** A step as the subject of a cook question (HON-983) */
export function step(index: number): CookQuestionSubject {
  return { kind: 'step', index }
}

/**
 * jsdom has no scrollIntoView; the panel calls it on open and on arrival.
 * Call inside a `describe`: it stubs the spy before each test.
 */
export const scrollIntoView = vi.fn()
export function stubScrollIntoView() {
  beforeEach(() => {
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView
    document.documentElement.removeAttribute('data-reduced-motion')
  })
}

/** The modal's side of the contract: one open step, held in state. */
export function Harness({
  controls = {},
  open = null,
  onOpen,
}: {
  controls?: Partial<Omit<CookQuestionControls, 'openSubject' | 'onOpenSubject' | 'onClose'>>
  /**
   * The panel open at first. A busy row's menu cannot open its panel, and in
   * the app a ready-made question opened it before the answer went pending.
   */
  open?: CookQuestionSubject | null
  /** Sees each open, which resets the hook and aborts its answer */
  onOpen?: (subject: CookQuestionSubject) => void
}) {
  const [openSubject, setOpenSubject] = useState<CookQuestionSubject | null>(open)
  return (
    <PreparationSteps
      steps={sampleTips}
      isLoading={false}
      error={null}
      onRetry={vi.fn()}
      onToggleStep={vi.fn()}
      cookQuestion={{
        openSubject,
        onOpenSubject: (subject) => {
          onOpen?.(subject)
          setOpenSubject(subject)
        },
        onClose: () => setOpenSubject(null),
        ask: vi.fn(),
        active: null,
        previous: null,
        isPending: false,
        isStreaming: false,
        error: null,
        onRetry: vi.fn(),
        ...controls,
      }}
    />
  )
}

export const menuButton = (n: number) => screen.getByRole('button', { name: `Ask about step ${n}` })
export const openPanel = (n: number) => pick(menuButton(n), 'Ask your own question')
export const panel = (n: number) => screen.queryByRole('group', { name: `Ask about step ${n}` })
export const card = (n = 1) => panel(n)?.querySelector<HTMLElement>('[data-slot="card"]')
