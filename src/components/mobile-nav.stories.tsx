import type { Meta, StoryObj } from '@storybook/nextjs-vite'
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

const meta = {
  title: 'Feature/Navigation/MobileNav',
  component: MobileNav,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Hamburger menu + right-side `Sheet` — the mobile counterpart to `HeaderActions`. Hidden on `md:` and up. Houses Profile, Sign out, sign-in/up, and the theme toggle.',
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
          'Authenticated but no household. The Profile link is suppressed (same rule as `HeaderActions`) — Sign out and theme toggle remain so the user can escape onboarding.',
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

export const MenuOpens: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Toggle menu' })

    await userEvent.click(trigger)

    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(body.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(body.getByRole('link', { name: 'Profile' })).toBeInTheDocument()
    expect(body.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  },
}

export const UnauthenticatedMenuOpens: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Toggle menu' })

    await userEvent.click(trigger)

    const body = within(document.body)
    await body.findByRole('dialog')
    expect(body.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(body.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
    expect(body.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  },
}

export const EscapeClosesMenu: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'Toggle menu' })

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
    const trigger = canvas.getByRole('button', { name: 'Toggle menu' })

    await userEvent.click(trigger)
    await assertFocusInDialog()
    await assertTabStaysInDialog()

    await userEvent.keyboard('{Escape}')
    await awaitDialogClosed()
  },
}
