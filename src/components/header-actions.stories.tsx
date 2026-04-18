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
          'Right-side header chrome — desktop only (`hidden md:flex` at the component root, hidden below `md:`). Shows sign-in/up CTAs when logged out, a user-menu dropdown (Profile, Sign out, theme toggle) when logged in. The Profile item is suppressed during onboarding (authenticated but no household yet).',
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
    // regardless of the iframe's resolved viewport. The test-runner cannot
    // reliably size the preview iframe to match the story's `globals.viewport`,
    // so a CSS override is more robust than relying on breakpoints for stories
    // that target desktop-only components.
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
    expect(body.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument()
    expect(body.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument()
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
