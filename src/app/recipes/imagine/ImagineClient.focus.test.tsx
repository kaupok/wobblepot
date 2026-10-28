import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The announcement is checked in both languages against the real catalog.
vi.unmock('next-intl')
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImagineClient } from './ImagineClient'
import { generate, renderInLocale } from './ImagineClient.fixtures'
import { saveImagineSession } from './imagine-session'
import type { ImaginedMealResponse } from '@/lib/imagine-utils'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))

// Busy controls are `aria-disabled`, not `disabled`, so they keep focus:
// Chromium drops focus to <body> when a focused control becomes `disabled`.
// jsdom does not, so `toBeEnabled()` is the assertion that goes red on the old
// `disabled` and the focus check guards the handoff (HON-1366).
describe('ImagineClient focus and announcements (HON-1366)', () => {
  const idea = (id: string, name: string) =>
    ({
      id,
      name,
      description: null,
      timeMinutes: 25,
      servings: 4,
      suitableFor: ['dinner'],
      kidFriendly: false,
      primaryProteinType: 'legume',
      components: [],
      nutrition: { calories: 480, protein: 24, carbs: 62, fat: 12 },
      ingredients: [],
      allMatched: true,
    }) as unknown as ImaginedMealResponse

  const ideas = [
    idea('im-1', 'Lentil soup'),
    idea('im-2', 'Chickpea curry'),
    idea('im-3', 'Bean chili'),
  ]

  /** Holds every fetch open until the returned function answers it. */
  function deferFetch() {
    let answer: (response: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((resolve) => (answer = resolve))),
    )
    return (body: Record<string, unknown>, status = 200) =>
      act(async () => answer({ ok: status < 400, status, json: () => Promise.resolve(body) }))
  }

  function expectBusy(control: HTMLElement) {
    expect(control).toHaveAttribute('aria-disabled', 'true')
    expect(control).toBeEnabled()
  }

  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps focus in the prompt field after Enter, then announces the ideas', async () => {
    const respond = deferFetch()
    const user = userEvent.setup()
    renderInLocale(<ImagineClient />, 'en')

    const prompt = screen.getByRole('textbox', { name: /describe/i })
    await user.type(prompt, 'something with lentils{Enter}')

    expectBusy(prompt)
    expect(prompt).toHaveAttribute('readonly')
    expect(prompt).toHaveFocus()
    expectBusy(screen.getByRole('button', { name: /generating ideas/i }))

    await respond({ success: true, meals: ideas })

    expect(await screen.findByRole('heading', { name: 'Lentil soup' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('3 meal ideas ready')
    expect(prompt).toHaveFocus()
    expect(prompt).not.toHaveAttribute('aria-disabled')
  })

  it('announces the ideas in Estonian', async () => {
    const respond = deferFetch()
    await generate('et')
    await respond({ success: true, meals: ideas })

    await screen.findByRole('heading', { name: 'Lentil soup' })
    expect(screen.getByRole('status')).toHaveTextContent('3 toiduideed valmis')
  })

  it('keeps focus on "Imagine meals" after a click and ignores a second press', async () => {
    deferFetch()
    const user = userEvent.setup()
    renderInLocale(<ImagineClient />, 'en')

    await user.type(screen.getByRole('textbox', { name: /describe/i }), 'something with lentils')
    await user.click(screen.getByRole('button', { name: 'Imagine meals' }))

    const button = screen.getByRole('button', { name: /generating ideas/i })
    expectBusy(button)
    expect(button).toHaveFocus()

    await user.click(button)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  // Cancel unmounts as the run stops, so focus would fall to <body> (HON-1373).
  it.each([
    [
      'a click',
      (user: ReturnType<typeof userEvent.setup>, cancel: HTMLElement) => user.click(cancel),
    ],
    [
      'the keyboard',
      async (user: ReturnType<typeof userEvent.setup>, cancel: HTMLElement) => {
        cancel.focus()
        await user.keyboard('{Enter}')
      },
    ],
  ])('moves focus to the prompt field after Cancel by %s', async (_, press) => {
    deferFetch()
    const user = userEvent.setup()
    renderInLocale(<ImagineClient />, 'en')

    const prompt = screen.getByRole('textbox', { name: /describe/i })
    await user.type(prompt, 'something with lentils')
    await user.click(screen.getByRole('button', { name: 'Imagine meals' }))

    await press(user, screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument()
    expect(prompt).toHaveFocus()
    expect(prompt).not.toHaveAttribute('aria-disabled')
  })

  it('announces "Loading…" once per loading card', async () => {
    deferFetch()
    await generate('en')

    expect(await screen.findAllByRole('status', { name: 'Loading…' })).toHaveLength(3)
  })

  it('stays silent when ideas are restored from the stash', async () => {
    saveImagineSession({ prompt: 'something with lentils', meals: ideas })
    renderInLocale(<ImagineClient />, 'en')

    await screen.findByRole('heading', { name: 'Lentil soup' })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('keeps focus on the pressed "Review and save" while the recipe gets ready, then moves it into the dialog', async () => {
    saveImagineSession({ prompt: 'something with lentils', meals: ideas })
    const respond = deferFetch()
    const user = userEvent.setup()
    renderInLocale(<ImagineClient />, 'en')

    await screen.findByRole('heading', { name: 'Lentil soup' })
    const [first, second, third] = screen.getAllByRole('button', { name: 'Review and save' }) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    await user.click(second)

    expect(second).toHaveAccessibleName('Getting the recipe ready…')
    expect(second).toHaveFocus()
    for (const button of [first, second, third]) expectBusy(button)

    // A press on another idea while one is fine-tuning starts nothing.
    await user.click(first)
    expect(fetch).toHaveBeenCalledTimes(1)

    // The review degrades to the unreviewed meal on a failure.
    await respond({ error: 'Review failed' }, 500)

    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
  })
})
