import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import {
  errorGenerateHandlers,
  rateLimitGenerateHandlers,
  slowGenerateHandlers,
} from '@/stories/msw-handlers'
import { FillDaysAction } from './FillDaysAction'

const meta = {
  title: 'Feature/Timeline/FillDaysAction',
  component: FillDaysAction,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    planId: 'plan-1',
    firstEmptyDate: '2026-04-16',
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
    await waitFor(() => expect(canvas.getByRole('button', { name: /generating…/i })).toBeDisabled())
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
      expect(canvas.getByText(/generation failed\. please try again/i)).toBeVisible(),
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
