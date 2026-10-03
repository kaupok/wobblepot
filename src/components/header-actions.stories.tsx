import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { http, HttpResponse } from 'msw'
import { createSession } from '@/stories/fixtures'
import { HeaderActions } from './header-actions'

const authedSession = createSession()

// WHY: Better Auth's `authClient.signOut()` hits `/api/auth/sign-out` under the
// hood. The play functions don't actually click "Sign out" (that belongs in the
// logic-level .test.tsx), but the handler is here so any stray click during
// exploration in the Storybook UI succeeds instead of erroring.
const signOutHandler = http.post('/api/auth/sign-out', () => HttpResponse.json({ ok: true }))

const meta = {
  title: 'Feature/Navigation/HeaderActions',
  component: HeaderActions,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Right-side header chrome — desktop only (`hidden md:flex` at the component root, hidden below `md:`). Shows sign-in/up CTAs when logged out, a user-menu dropdown (Past meals, Profile, Sign out, theme toggle) when logged in. The Past meals and Profile items are suppressed during onboarding (authenticated but no household yet). While past meals are still to mark (`pastMealsToMark` above 0), a red dot sits on the account icon and on the Past meals row, and both accessible names say so (HON-1028).',
      },
    },
    msw: { handlers: { extra: [signOutHandler] } },
  },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  args: {
    session: null,
    hasHousehold: false,
  },
  decorators: [
    // Force the component's `hidden md:flex` root to render as `flex`
    // regardless of the iframe's resolved viewport. The Storybook viewport
    // addon only resizes the preview iframe — not the page — so relying on
    // `md:` breakpoints for desktop-only components is brittle in Storybook
    // dev and autodocs; a CSS override is a more robust belt-and-braces.
    (Story) => (
      <div className="flex min-h-12 items-center justify-end [&>div]:!flex">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeaderActions>

export default meta
type Story = StoryObj<typeof meta>

export const Unauthenticated: Story = {}

export const Authenticated: Story = {
  args: { session: authedSession, hasHousehold: true },
}

export const AuthenticatedNoHousehold: Story = {
  args: { session: authedSession, hasHousehold: false },
  parameters: {
    docs: {
      description: {
        story:
          'Authenticated but no household — the onboarding state. Profile is suppressed; Sign out and theme toggle remain so the user can still escape.',
      },
    },
  },
}

export const MenuOpensOnClick: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'User menu' })

    await userEvent.click(trigger)

    const body = within(document.body)
    // Radix DropdownMenu portals the content to document.body
    const menu = await body.findByRole('menu')
    expect(menu).toBeInTheDocument()
    expect(body.getByRole('menuitem', { name: 'Past meals' })).toHaveAttribute(
      'href',
      '/past-meals',
    )
    expect(body.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument()
    expect(body.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
    // Nothing to mark (the default 0): no dot anywhere.
    expect(document.querySelector('[data-slot="attention-dot"]')).toBeNull()
  },
}

export const PastMealsToMark: Story = {
  args: { session: authedSession, hasHousehold: true, pastMealsToMark: 3 },
  parameters: {
    docs: {
      description: {
        story:
          'Past meals are still to mark: a red dot on the account icon and on the Past meals row. The dot is `aria-hidden`; the trigger is named "User menu, past meals to mark" and the row adds "(to mark)" for screen readers.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'User menu, past meals to mark' })
    await expect(trigger.querySelector('[data-slot="attention-dot"]')).toBeVisible()

    await userEvent.click(trigger)

    const body = within(document.body)
    const row = await body.findByRole('menuitem', { name: /^Past meals\s*\(to mark\)$/ })
    await expect(row.querySelector('[data-slot="attention-dot"]')).toBeVisible()
    // Only the Past meals row carries it.
    await expect(
      body.getByRole('menuitem', { name: 'Profile' }).querySelector('[data-slot="attention-dot"]'),
    ).toBeNull()
  },
}

export const EscapeClosesMenu: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'User menu' })

    await userEvent.click(trigger)

    const body = within(document.body)
    await body.findByRole('menu')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(body.queryByRole('menu')).not.toBeInTheDocument()
    })
  },
}

export const OnboardingMenuHidesProfile: Story = {
  args: { session: authedSession, hasHousehold: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'User menu' })

    await userEvent.click(trigger)

    const body = within(document.body)
    await body.findByRole('menu')

    expect(body.queryByRole('menuitem', { name: 'Profile' })).not.toBeInTheDocument()
    expect(body.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
  },
}

export const MenuOpensViaKeyboard: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('button', { name: 'User menu' })

    // Tab to focus the trigger, then open with Enter
    await userEvent.tab()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    await userEvent.keyboard('{Enter}')

    const body = within(document.body)
    const menu = await body.findByRole('menu')
    expect(menu).toBeInTheDocument()
  },
}
