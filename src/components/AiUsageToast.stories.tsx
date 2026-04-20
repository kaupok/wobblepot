import type { Decorator, Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { Toaster } from 'sonner'
import { AiUsageToast } from './AiUsageToast'

const withSonner: Decorator = (Story) => {
  // WHY: AiUsageToast renders nothing visible — it triggers a `sonner` toast
  // when the household crosses 80% of its monthly cap. The `<Toaster />` here
  // gives the toast somewhere to mount inside the Storybook canvas.
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem('ai-usage-toast-shown')
  }
  return (
    <div className="min-h-[200px] p-4">
      <p className="text-muted-foreground text-sm">
        AiUsageToast renders nothing — its only side effect is showing a sonner toast when the
        household has spent 80–100% of its monthly AI cap.
      </p>
      <Toaster richColors closeButton duration={6000} />
      <Story />
    </div>
  )
}

const meta = {
  title: 'Feature/AiUsageToast',
  component: AiUsageToast,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Background poller that fires a single warning toast when household AI spend reaches 80% of the monthly cap. Renders nothing — the component exists purely for its side effect. Uses sessionStorage keyed by `YYYY-MM` to avoid repeat toasts on page reload within the same browser session.',
      },
    },
    // WHY: The visible markup in this story is the sonner warning toast — its
    // amber-on-cream palette is owned by sonner's `richColors`, not by this
    // component. Waiving color-contrast narrowly so the a11y gate still catches
    // any other violations the story might introduce.
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: false }] } },
  },
  decorators: [withSonner],
} satisfies Meta<typeof AiUsageToast>

export default meta
type Story = StoryObj<typeof meta>

export const AtThreshold: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/households/me/ai-usage', () =>
          HttpResponse.json({
            spendUsd: 4.25,
            capUsd: 5,
            percentage: 85,
            resetAt: '2026-05-01T00:00:00.000Z',
          }),
        ),
      ],
    },
  },
}

export const BelowThreshold: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/households/me/ai-usage', () =>
          HttpResponse.json({
            spendUsd: 1,
            capUsd: 5,
            percentage: 20,
            resetAt: '2026-05-01T00:00:00.000Z',
          }),
        ),
      ],
    },
  },
}

export const AtCap: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/households/me/ai-usage', () =>
          HttpResponse.json({
            spendUsd: 5,
            capUsd: 5,
            percentage: 100,
            resetAt: '2026-05-01T00:00:00.000Z',
          }),
        ),
      ],
    },
  },
}

export const Unauthenticated: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/households/me/ai-usage', () =>
          HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        ),
      ],
    },
  },
}
