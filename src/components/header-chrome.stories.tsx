import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'
import { Body, Heading } from '@/components/ui/typography'
import { createSession } from '@/stories/fixtures'
import { HeaderChrome } from './header-chrome'

const authedSession = createSession()

// WHY: `authClient.signOut()` in `HeaderActions` / `MobileNav` posts to
// `/api/auth/sign-out`. Provided so interactive exploration works.
const signOutHandler = http.post('/api/auth/sign-out', () => HttpResponse.json({ ok: true }))

/**
 * Enough page under the header to scroll, so the story shows what the floating
 * pills are for: the content passing under them, visible in the gap between.
 */
function PageBehind() {
  return (
    // The root layout's `main` padding, then the page container's `py-8`, so
    // the first title sits where it does on a real page.
    <main className="pt-[calc(4rem+env(safe-area-inset-top,0px))]">
      <div className="container mx-auto flex flex-col gap-4 px-4 py-8">
        <Heading variant="h4" as="h1">
          Today
        </Heading>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="rounded-lg border p-4">
            <Body>
              Row {i + 1} — scrolls under the header, and shows through the gap between the pills.
            </Body>
          </div>
        ))}
      </div>
    </main>
  )
}

const meta = {
  title: 'Feature/Navigation/Header',
  component: HeaderChrome,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The top chrome, rendered at the root layout on every page. It floats: the fixed bar is transparent and lets clicks through, and the chrome sits in bordered pills on it — on `md:` and up the logo with the daily views in one and the settings views with the account menu in the other, the page showing through between them; on a phone one pill across the column with the logo and the account icon at its ends. The skip-to-content link is the first thing in it (visible only when focused). `Header` (the server half) resolves the session and renders this.',
      },
    },
    msw: { handlers: { extra: [signOutHandler] } },
  },
  args: {
    session: null,
    hasHousehold: false,
    skipToContentLabel: 'Skip to content',
  },
  decorators: [
    (Story) => (
      <>
        <Story />
        <PageBehind />
      </>
    ),
  ],
} satisfies Meta<typeof HeaderChrome>

export default meta
type Story = StoryObj<typeof meta>

export const LoggedOut: Story = {}

export const LoggedIn: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    // The bar lets clicks through to the page; the pill under the logo does
    // not. Both are what make the header float rather than block.
    await expect(banner).toHaveStyle({ pointerEvents: 'none' })
    const logo = within(banner).getByRole('link', { name: 'Wobblepot' })
    await expect(logo.closest('div')).toHaveStyle({ pointerEvents: 'auto' })
  },
}

export const Scrolled: Story = {
  args: { session: authedSession, hasHousehold: true },
  parameters: {
    docs: {
      description: {
        story:
          'The fold. Scrolling past the top narrows the logo to nothing as it fades, so the daily views slide left and the pill closes around them; on a phone the whole pill draws in to a disc around the account icon. Back at the top it unfolds. The play scrolls the page both ways and asserts the `data-scrolled` attribute that drives the styles.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const logo = within(banner).getByRole('link', { name: 'Wobblepot' })
    await expect(banner).not.toHaveAttribute('data-scrolled')

    window.scrollTo(0, 400)
    await waitFor(() => expect(banner).toHaveAttribute('data-scrolled'))
    // Out of the tab order once folded (`invisible` after the transition).
    await waitFor(() => expect(logo).not.toBeVisible(), { timeout: 1500 })

    window.scrollTo(0, 0)
    await waitFor(() => expect(banner).not.toHaveAttribute('data-scrolled'))
    await waitFor(() => expect(logo).toBeVisible(), { timeout: 1500 })
  },
}

export const LoggedInOnboarding: Story = {
  args: { session: authedSession, hasHousehold: false },
  parameters: {
    docs: {
      description: {
        story:
          'Authenticated but no household yet. Nav groups stay hidden; user menu is present but Profile is suppressed so the user focuses on household setup.',
      },
    },
  },
}

export const Desktop: Story = {
  args: { session: authedSession, hasHousehold: true },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop layout — the phone pill dissolves into two: logo and daily views left, settings views and account menu right. Exercises the `md:` breakpoint where layout branches.',
      },
    },
  },
}

export const DesktopLoggedOut: Story = {
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop, no session — the right pill holds the sign-in / sign-up buttons and the theme toggle, the left one just the logo.',
      },
    },
  },
}
