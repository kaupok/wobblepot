import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import Link from 'next/link'
import { http, HttpResponse } from 'msw'
import { Heading } from '@/components/ui/typography'
import type { Session } from '@/lib/auth'
import { createSession } from '@/stories/fixtures'
import { HeaderActions } from './header-actions'
import { NavigationLeft, NavigationRight } from './navigation'
import { MobileNav } from './mobile-nav'

const authedSession = createSession()

// WHY: `authClient.signOut()` in `HeaderActions` / `MobileNav` posts to
// `/api/auth/sign-out`. Provided so interactive exploration works.
const signOutHandler = http.post('/api/auth/sign-out', () => HttpResponse.json({ ok: true }))

/**
 * Client-side reproduction of the `Header` server component's render tree.
 * The real `Header` awaits `getSession()` + `getHasHousehold()` (both import
 * Prisma transitively), so it cannot be rendered in Storybook's browser env.
 * This mirror accepts the resolved props directly — session-fetching is
 * already covered in `header.test.tsx`.
 */
interface HeaderPresentationProps {
  session: Session | null
  hasHousehold: boolean
}

function HeaderPresentation({ session, hasHousehold }: HeaderPresentationProps) {
  return (
    <header className="bg-background fixed top-0 right-0 left-0 z-50 border-b pt-[env(safe-area-inset-top,0px)]">
      <a
        href="#main-content"
        className="focus:bg-background focus:text-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:ring-2 focus:ring-offset-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 w-full max-w-[1152px] items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="transition-opacity hover:opacity-70">
            <Heading variant="h4">Honkadori</Heading>
          </Link>
          <NavigationLeft session={session} hasHousehold={hasHousehold} />
        </div>
        <div className="flex items-center gap-8">
          <NavigationRight session={session} hasHousehold={hasHousehold} />
          <HeaderActions session={session} hasHousehold={hasHousehold} />
          <MobileNav session={session} hasHousehold={hasHousehold} />
        </div>
      </div>
    </header>
  )
}

const meta = {
  title: 'Feature/Navigation/Header',
  component: HeaderPresentation,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The full top header chrome. Rendered at the root layout, visible on every authenticated page. On mobile: shows the logo + hamburger trigger. On `md:` and up: adds the left/right nav groups and the user-menu dropdown. Includes a skip-to-content link for screen-reader users (not visible until focused).',
      },
    },
    msw: { handlers: { extra: [signOutHandler] } },
  },
  args: {
    session: null,
    hasHousehold: false,
  },
  decorators: [
    (Story) => (
      // Push the fixed header down from the Storybook canvas edge so the
      // skip-link focus ring isn't clipped on hover.
      <div className="min-h-32 pt-16">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeaderPresentation>

export default meta
type Story = StoryObj<typeof meta>

export const LoggedOut: Story = {}

export const LoggedIn: Story = {
  args: { session: authedSession, hasHousehold: true },
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
          'Desktop layout — full nav visible, hamburger hidden. Exercises the `md:` breakpoint where layout branches.',
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
        story: 'Desktop, no session — sign-in / sign-up buttons visible, nav groups empty.',
      },
    },
  },
}
