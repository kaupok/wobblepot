import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { assertFocusReturnsAfterWait } from '@/stories/a11y-helpers'
import {
  delayedErrorGenerateHandlers,
  delayedGenerateHandlers,
  errorGenerateHandlers,
  rateLimitGenerateHandlers,
  slowGenerateHandlers,
  timeoutGenerateHandlers,
} from '@/stories/msw-handlers'
import { FillDaysAction } from './FillDaysAction'

const meta = {
  title: 'Feature/Timeline/FillDaysAction',
  component: FillDaysAction,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    startDate: '2026-04-16',
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FillDaysAction>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Generating: Story = {
  parameters: {
    msw: { handlers: slowGenerateHandlers },
    docs: {
      description: {
        story:
          'Generate request never resolves — the `GeneratingOverlay` renders full-screen behind the card.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const generate = canvas.getByRole('button', { name: /^generate$/i })
    await userEvent.click(generate)
    // The overlay is a modal dialog, so the page under it is `aria-hidden`.
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /generating…/i, hidden: true })).toBeDisabled(),
    )
    await expect(
      within(document.body).getByRole('dialog', { name: /generating your meal plan/i }),
    ).toBeVisible()
  },
}

/** After a plan is generated, focus is back on Generate, not on the body (HON-1130). */
export const FocusReturnsAfterSuccess: Story = {
  parameters: {
    msw: { handlers: delayedGenerateHandlers },
  },
  play: async ({ canvasElement }) => {
    const generate = within(canvasElement).getByRole('button', { name: /^generate$/i })
    await userEvent.click(generate)
    await assertFocusReturnsAfterWait(generate)
  },
}

/** After a failed generation, focus is back on Generate, next to the error (HON-1130). */
export const FocusReturnsAfterError: Story = {
  parameters: {
    msw: { handlers: delayedErrorGenerateHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const generate = canvas.getByRole('button', { name: /^generate$/i })
    await userEvent.click(generate)
    await assertFocusReturnsAfterWait(generate)
    await expect(canvas.getByText(/failed to generate meals\. please try again/i)).toBeVisible()
  },
}

export const Error: Story = {
  parameters: {
    msw: { handlers: errorGenerateHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^generate$/i }))
    await waitFor(() =>
      expect(canvas.getByText(/failed to generate meals\. please try again/i)).toBeVisible(),
    )
  },
}

export const RateLimited: Story = {
  parameters: {
    msw: { handlers: rateLimitGenerateHandlers },
    docs: {
      description: {
        story:
          '429 response — component shows the rate-limit specific copy instead of the server message.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^generate$/i }))
    await waitFor(() =>
      expect(canvas.getByText(/rate limit exceeded\. please try again later/i)).toBeVisible(),
    )
  },
}

export const TimedOut: Story = {
  parameters: {
    msw: { handlers: timeoutGenerateHandlers },
    docs: {
      description: {
        story:
          '504 response — the server gave up inside its own AI budget (HON-694). The component shows the localized timeout copy, not the English message the route sent.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^generate$/i }))
    await waitFor(() =>
      expect(canvas.getByText(/generation timed out\. please try again/i)).toBeVisible(),
    )
  },
}

// Play story — verify the "Generate" click fires the POST with the expected
// payload shape. We install a per-story handler that records each request into
// an `fn()` spy so the play function can assert on the body the component sent.
const generateSpy = fn<(payload: unknown) => void>()

export const GenerateInvokesApi: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/meal-plans/generate', async ({ request }) => {
          const payload = await request.json()
          generateSpy(payload)
          return HttpResponse.json({ planId: 'plan-1', ok: true })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    generateSpy.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^generate$/i }))
    await waitFor(() => expect(generateSpy).toHaveBeenCalledTimes(1))
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'fill-empty',
        planId: 'plan-1',
        startDate: '2026-04-16',
        endDate: '2026-04-23',
      }),
    )
  },
}

type Box = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>

function intersects(a: Box, b: Box) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function contains(outer: Box, inner: Box) {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  )
}

/** Picks 14 days and returns the boxes of the card, label, select and Generate. */
async function chooseFourteenDaysAndMeasure(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  // Queried before the select opens: Radix keeps the canvas `aria-hidden`
  // until its close animation ends, so a role query then finds nothing.
  const select = canvas.getByRole('combobox', { name: /number of days to fill/i })
  const button = canvas.getByRole('button', { name: /^generate$/i })
  await userEvent.click(select)
  await userEvent.click(await within(document.body).findByRole('option', { name: '14 days' }))
  // Wait for the listbox to unmount, or the a11y check runs mid-animation.
  await waitFor(() => expect(document.querySelector('[role="listbox"]')).toBeNull())

  const label = await canvas.findByText(/^Fill Nov 28\W+Dec 11$/)
  const card = canvasElement.querySelector('.rounded-lg')
  if (!card) throw new globalThis.Error('Expected the Fill bar card')
  return {
    card: card.getBoundingClientRect(),
    label: label.getBoundingClientRect(),
    select: select.getBoundingClientRect(),
    button: button.getBoundingClientRect(),
  }
}

/**
 * 390px with the longest range the bar shows. The label takes its own line and
 * the select and Generate sit side by side under it; Generate used to cover the
 * select's chevron here (HON-1127).
 */
export const Phone: Story = {
  args: { startDate: '2026-11-28' },
  globals: { viewport: { value: 'mobileIphone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const { card, label, select, button } = await chooseFourteenDaysAndMeasure(canvasElement)
    expect(intersects(select, button)).toBe(false)
    for (const box of [label, select, button]) expect(contains(card, box)).toBe(true)
    // Two lines: the controls wrap under the label, side by side.
    for (const box of [select, button]) expect(box.top).toBeGreaterThanOrEqual(label.bottom)
    expect(select.right).toBeLessThanOrEqual(button.left)
    expect(button.top).toBeLessThan(select.bottom)
  },
}

/** From `sm` the label, select and Generate stay in one row. */
export const Desktop: Story = {
  args: { startDate: '2026-11-28' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvasElement }) => {
    const { card, label, select, button } = await chooseFourteenDaysAndMeasure(canvasElement)
    expect(intersects(select, button)).toBe(false)
    for (const box of [label, select, button]) expect(contains(card, box)).toBe(true)
    for (const box of [select, button]) {
      expect(box.top).toBeLessThan(label.bottom)
      expect(box.bottom).toBeGreaterThan(label.top)
    }
  },
}
