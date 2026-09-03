import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { errorGenerateHandlers, slowGenerateHandlers } from '@/stories/msw-handlers'
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
    await waitFor(() => expect(canvas.getByRole('button', { name: /generating…/i })).toBeDisabled())

    // This story renders the one pairing that constrains `GeneratingOverlay`'s
    // tag outside the timeline: the overlay's status heading sits immediately
    // before this screen's own title. axe cannot judge it — the overlay comes
    // first, so any tag reads as a legal decrease — but a transient status
    // message must not outrank the screen it covers. HON-607 migrates both
    // headings' variants, so pin the relationship rather than either level
    // (HON-619, PR #700 review).
    const status = canvas.getByRole('heading', { name: /generating your meal plan/i })
    const title = canvas.getByRole('heading', { name: /^welcome to wobblepot/i })
    expect(Number(status.tagName.slice(1))).toBeGreaterThanOrEqual(Number(title.tagName.slice(1)))
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
      expect(canvas.getByText(/generation failed\. please try again/i)).toBeVisible(),
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

    // Switch to "Tomorrow" (default is Today).
    await userEvent.click(canvas.getByRole('button', { name: /^tomorrow$/i }))

    // Switch day count from 7 to 3.
    await userEvent.click(canvas.getByRole('button', { name: /^3 days$/i }))

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
