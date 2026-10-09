import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { assertFocusReturnsAfterWait } from '@/stories/a11y-helpers'
import {
  delayedErrorGenerateHandlers,
  delayedGenerateHandlers,
  errorGenerateHandlers,
  slowGenerateHandlers,
  timeoutGenerateHandlers,
} from '@/stories/msw-handlers'
import { FirstTimeSetup } from './FirstTimeSetup'

const meta = {
  title: 'Feature/Timeline/FirstTimeSetup',
  component: FirstTimeSetup,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FirstTimeSetup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithUserName: Story = {
  args: { userName: 'Alex' },
}

export const LongUserName: Story = {
  args: { userName: 'Konstantinos-Alexandros' },
  parameters: {
    docs: {
      description: {
        story: 'Stress-test for overflow on the welcome heading with a long user name.',
      },
    },
  },
}

export const Generating: Story = {
  args: { userName: 'Alex' },
  parameters: {
    msw: { handlers: slowGenerateHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^generate meal plan$/i }))
    // The overlay is a modal dialog, so the page under it is `aria-hidden`.
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /generating…/i, hidden: true })).toBeDisabled(),
    )

    // This story renders the one pairing that constrains `GeneratingOverlay`'s
    // tag outside the timeline: the overlay's status heading covers this
    // screen's own title. axe does not judge it — the overlay is a modal
    // dialog in a portal, and the page under it is `aria-hidden` — but a
    // transient status message must not outrank the screen it covers. HON-607 migrates both
    // headings' variants, so pin the relationship rather than either level
    // (HON-619, PR #700 review).
    const status = within(document.body).getByRole('heading', {
      name: /generating your meal plan/i,
    })
    const title = canvas.getByRole('heading', { name: /^welcome to wobblepot/i, hidden: true })
    expect(Number(status.tagName.slice(1))).toBeGreaterThanOrEqual(Number(title.tagName.slice(1)))
  },
}

/** After a plan is generated, focus is back on Generate, not on the body (HON-1130). */
export const FocusReturnsAfterSuccess: Story = {
  args: { userName: 'Alex' },
  parameters: {
    msw: { handlers: delayedGenerateHandlers },
  },
  play: async ({ canvasElement }) => {
    const generate = within(canvasElement).getByRole('button', { name: /^generate meal plan$/i })
    await userEvent.click(generate)
    await assertFocusReturnsAfterWait(generate)
  },
}

/** After a failed generation, focus is back on Generate, next to the error (HON-1130). */
export const FocusReturnsAfterError: Story = {
  args: { userName: 'Alex' },
  parameters: {
    msw: { handlers: delayedErrorGenerateHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const generate = canvas.getByRole('button', { name: /^generate meal plan$/i })
    await userEvent.click(generate)
    await assertFocusReturnsAfterWait(generate)
    await expect(canvas.getByText(/failed to generate meals\. please try again/i)).toBeVisible()
  },
}

export const Error: Story = {
  args: { userName: 'Alex' },
  parameters: {
    msw: { handlers: errorGenerateHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^generate meal plan$/i }))
    await waitFor(() =>
      expect(canvas.getByText(/failed to generate meals\. please try again/i)).toBeVisible(),
    )
  },
}

export const TimedOut: Story = {
  args: { userName: 'Alex' },
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
    await userEvent.click(canvas.getByRole('button', { name: /^generate meal plan$/i }))
    await waitFor(() =>
      expect(canvas.getByText(/generation timed out\. please try again/i)).toBeVisible(),
    )
  },
}

// Play story — asserts the full setup flow: pick a start date, pick a days
// count, click Generate, verify the POST body has the user's selections.
const generateSpy = fn<(payload: unknown) => void>()

export const SetupFlowInvokesApi: Story = {
  args: { userName: 'Alex' },
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

    // Both choices are named radiogroups, labelled by their section headings,
    // with exactly one radio checked (HON-828).
    const startFrom = within(canvas.getByRole('radiogroup', { name: /^start from$/i }))
    const daysCount = within(canvas.getByRole('radiogroup', { name: /^how many days$/i }))
    await expect(daysCount.getByRole('radio', { name: /^7 days$/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // Switch to "Tomorrow" (default is Today).
    const tomorrow = startFrom.getByRole('radio', { name: /^tomorrow$/i })
    await userEvent.click(tomorrow)
    await expect(tomorrow).toHaveAttribute('aria-checked', 'true')

    // Switch day count from 7 to 3.
    const threeDays = daysCount.getByRole('radio', { name: /^3 days$/i })
    await userEvent.click(threeDays)
    await expect(threeDays).toHaveAttribute('aria-checked', 'true')
    await expect(
      daysCount.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(1)

    await userEvent.click(canvas.getByRole('button', { name: /^generate meal plan$/i }))

    await waitFor(() => expect(generateSpy).toHaveBeenCalledTimes(1))
    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'generate',
        startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
  },
}

export const Desktop: Story = {
  args: { userName: 'Alex' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop width. "Generate meal plan" is as wide as its label and starts at the column edge; on a phone it fills the card (HON-782).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Generate meal plan' })
    // Compare against the content box: CardContent's px-6 would make a
    // full-width button narrower than the parent's border box too.
    const parent = button.parentElement!
    const { paddingLeft, paddingRight } = getComputedStyle(parent)
    const contentWidth = parent.clientWidth - parseFloat(paddingLeft) - parseFloat(paddingRight)
    await expect(button.getBoundingClientRect().width).toBeLessThan(contentWidth)
  },
}
