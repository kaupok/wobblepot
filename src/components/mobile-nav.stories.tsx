import type { Decorator, Meta, StoryObj } from '@storybook/nextjs-vite'
import { ThemeProvider } from 'next-themes'
import { expect, userEvent, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import {
  assertFocusInDialog,
  assertTabStaysInDialog,
  awaitDialogClosed,
} from '@/stories/a11y-helpers'
import { createSession } from '@/stories/fixtures'
import { MobileNav } from './mobile-nav'

const authedSession = createSession()

// WHY: `authClient.signOut()` posts to `/api/auth/sign-out`. We don't exercise
// sign-out in any play function (that logic is covered in the .test.tsx), but
// the handler keeps interactive exploration from erroring if someone clicks it.
const signOutHandler = http.post('/api/auth/sign-out', () => HttpResponse.json({ ok: true }))

// WHY: Without a `next-themes` provider `resolvedTheme` is undefined and the
// theme row always reads "Dark mode". `forcedTheme` (as `theme-toggle.stories`
// uses) does not reach `resolvedTheme` in next-themes 0.4, so seed the toolbar
// theme as the default instead, remounting on change, with its own storage key
// so a real app preference in localStorage cannot leak in.
const withThemeProvider: Decorator = (Story, context) => {
  const theme = (context.globals.theme as string | undefined) ?? 'light'
  return (
    <ThemeProvider
      key={theme}
      attribute="class"
      defaultTheme={theme}
      enableSystem={false}
      storageKey={`storybook-mobile-nav-theme-${theme}`}
    >
      <Story />
    </ThemeProvider>
  )
}

// Names of the sheet's rows (links and buttons) in DOM order, so a play
// function can assert the order HON-775 fixes, not just presence.
function rowNames(nav: HTMLElement): string[] {
  const scoped = within(nav)
  return [...scoped.queryAllByRole('link'), ...scoped.queryAllByRole('button')]
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((el) => el.textContent?.trim() ?? '')
}

async function openSheet(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'User menu' }))
  const body = within(document.body)
  await body.findByRole('dialog')
  return body.getByRole('navigation', { name: 'Account menu' })
}

const meta = {
  title: 'Feature/Navigation/MobileNav',
  component: MobileNav,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Person-icon trigger + right-side `Sheet` — the mobile counterpart to `HeaderActions`, with the same accessible name ("User menu"). Hidden on `md:` and up. Signed in, it lists Household, Profile, the labelled theme row and Sign out, in that order (HON-775); signed out, Sign in, Sign up and the theme row.',
      },
    },
    msw: { handlers: { extra: [signOutHandler] } },
  },
  args: {
    session: null,
    hasHousehold: false,
  },
  decorators: [
    withThemeProvider,
    (Story) => (
      <div className="flex min-h-12 items-center justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MobileNav>

export default meta
type Story = StoryObj<typeof meta>

export const ClosedUnauthenticated: Story = {}

export const ClosedAuthenticated: Story = {
  args: { session: authedSession, hasHousehold: true },
}

export const ClosedOnboarding: Story = {
  args: { session: authedSession, hasHousehold: false },
  parameters: {
    docs: {
      description: {
        story:
          'Authenticated but no household. The Household and Profile links are suppressed (same rule as `HeaderActions`) — the theme row and Sign out remain so the user can escape onboarding.',
      },
    },
  },
}

export const DesktopHidden: Story = {
  args: { session: authedSession, hasHousehold: true },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'At `md:` and wider, the trigger is hidden (`md:hidden`). Only the empty container remains.',
      },
    },
  },
}

export const SignedInWithHousehold: Story = {
  globals: { theme: 'light' },
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const nav = await openSheet(canvasElement)
    const body = within(document.body)

    expect(body.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(rowNames(nav)).toEqual(['Household', 'Profile', 'Dark mode', 'Sign out'])
    expect(within(nav).getByRole('link', { name: 'Household' })).toHaveAttribute(
      'href',
      '/household',
    )
    await assertFocusInDialog()
  },
}

export const SignedInWithoutHousehold: Story = {
  globals: { theme: 'light' },
  args: { session: authedSession, hasHousehold: false },
  play: async ({ canvasElement }) => {
    const nav = await openSheet(canvasElement)

    expect(rowNames(nav)).toEqual(['Dark mode', 'Sign out'])
    expect(within(nav).queryByRole('link', { name: 'Household' })).not.toBeInTheDocument()
  },
}

export const SignedOut: Story = {
  globals: { theme: 'light' },
  play: async ({ canvasElement }) => {
    const nav = await openSheet(canvasElement)

    expect(rowNames(nav)).toEqual(['Sign in', 'Sign up', 'Dark mode'])
  },
}

// The label names the theme the row switches *to*, so a dark preview reads
// "Light mode" — the same strings as the desktop menu (`useThemeToggle`).
export const DarkThemeLabel: Story = {
  args: { session: authedSession, hasHousehold: true },
  globals: { theme: 'dark' },
  play: async ({ canvasElement }) => {
    const nav = await openSheet(canvasElement)

    expect(rowNames(nav)).toEqual(['Household', 'Profile', 'Light mode', 'Sign out'])
  },
}

export const EscapeClosesMenu: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'User menu' })

    await userEvent.click(trigger)
    await assertFocusInDialog()

    await userEvent.keyboard('{Escape}')
    await awaitDialogClosed()
    // Focus-restore on close is intentionally not asserted here — see
    // .storybook/README.md "Modal a11y play-function conventions" and HON-446.
  },
}

// Interaction-a11y story — asserts focus trap on open, tab containment, and
// close-sequence completion. Focus-restore to the real trigger on close is
// covered above and by HON-446 in E2E. See `src/stories/a11y-helpers.ts`.
export const A11yInteractionPatterns: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'User menu' })

    await userEvent.click(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    await userEvent.keyboard('{Escape}')
    await awaitDialogClosed()
  },
}
