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
      <div className="flex w-full flex-col gap-4 px-4 py-8">
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

/**
 * The box of a link's visible text, ignoring its padding and any icon beside
 * it: a range from the first text node to the last.
 */
function textBox(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode() as Text
  let last = first
  while (walker.nextNode()) last = walker.currentNode as Text
  const range = document.createRange()
  range.setStart(first, 0)
  range.setEnd(last, last.length)
  return range.getBoundingClientRect()
}

const box = (el: Element) => el.getBoundingClientRect()

/** Equal to within a pixel: subpixel text widths round differently per browser. */
async function expectNear(actual: number, expected: number) {
  await expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1)
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

export const LoggedOut: Story = {
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    await expect(within(banner).getByRole('link', { name: 'Wobblepot' })).toHaveAttribute(
      'href',
      '/',
    )
    // Signed out as signed in: the wordmark is not a heading (HON-806).
    await expect(within(banner).queryByRole('heading')).not.toBeInTheDocument()
  },
}

export const LoggedIn: Story = {
  args: { session: authedSession, hasHousehold: true },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    // The bar lets clicks through to the page; the pill under the logo does
    // not. Both are what make the header float rather than block.
    await expect(banner).toHaveStyle({ pointerEvents: 'none' })
    const logo = within(banner).getByRole('link', { name: 'Wobblepot' })
    await expect(logo.closest('div')).toHaveStyle({ pointerEvents: 'auto' })
    // The wordmark is a link, not a heading: each page's own `h1` opens its
    // outline (HON-806).
    await expect(within(banner).queryByRole('heading')).not.toBeInTheDocument()
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
          'Desktop layout — the phone pill dissolves into two: logo and daily views left, settings views and account menu right. Exercises the `md:` breakpoint where layout branches. The space between links is the links’ own padding, not a gap, so neighbours share an edge; the play measures that the labels still sit 24px apart and 20px in from the pill’s edge (HON-922).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const primary = within(banner).getByRole('navigation', { name: 'Primary' })
    const settings = within(banner).getByRole('navigation', { name: 'Settings' })
    const leftPill = box(primary.parentElement!)
    const rightPill = box(settings.parentElement!)
    const logo = textBox(within(banner).getByRole('link', { name: 'Wobblepot' }))
    const today = within(primary).getByRole('link', { name: 'Today' })
    const pantry = within(primary).getByRole('link', { name: 'Pantry & shopping' })
    const recipes = within(settings).getByRole('link', { name: 'My recipes' })
    const household = within(settings).getByRole('link', { name: 'Household' })

    // 20px padding inside a 1px border, at both ends of the left pill and
    // the start of the right one.
    await expectNear(logo.left - leftPill.left, 21)
    await expectNear(leftPill.right - textBox(pantry).right, 21)
    await expectNear(textBox(recipes).left - rightPill.left, 21)
    // 24px between labels, as when it was a `gap-6`.
    await expectNear(textBox(today).left - logo.right, 24)
    await expectNear(textBox(pantry).left - textBox(today).right, 24)
    await expectNear(textBox(household).left - textBox(recipes).right, 24)
    // ...but the links themselves touch.
    await expectNear(box(pantry).left, box(today).right)
    await expectNear(box(household).left, box(recipes).right)
  },
}

export const DesktopScrolled: Story = {
  args: { session: authedSession, hasHousehold: true },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'The right pill folds to icons. Scrolled, My recipes and Household close to their icons and the pill narrows around them; hovering or keyboard-focusing a link opens that link’s label only. The folded label stays the link’s accessible name. Each folded link is the account button’s 40px box, and the three touch, so a pointer sweeping across them is always over one of them and the icons sit evenly (HON-922). The play scrolls, measures both label boxes closing, the three boxes meeting edge to edge and the even icon spacing, then keyboard-focuses My recipes and measures its label opening while Household’s stays closed.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const settingsNav = within(banner).getByRole('navigation', { name: 'Settings' })
    const recipes = within(settingsNav).getByRole('link', { name: 'My recipes' })
    const household = within(settingsNav).getByRole('link', { name: 'Household' })
    // The label's clipping box: the link's last child (icon box, label box).
    const labelBox = (link: HTMLElement) => link.lastElementChild!.getBoundingClientRect().width

    await expect(labelBox(recipes)).toBeGreaterThan(0)

    window.scrollTo(0, 400)
    await waitFor(() => expect(banner).toHaveAttribute('data-scrolled'))
    await waitFor(() => expect(labelBox(recipes)).toBe(0), { timeout: 1500 })
    await waitFor(() => expect(labelBox(household)).toBe(0), { timeout: 1500 })
    await expect(recipes).toHaveAccessibleName('My recipes')

    // No dead space: each control starts where the one before it ends.
    const account = within(banner).getByRole('button', { name: 'User menu' })
    await expectNear(box(household).left, box(recipes).right)
    await expectNear(box(account).left, box(household).right)
    // Even icons: Household sits as far from the account icon as from Recipes.
    const glyph = (el: HTMLElement) => box(el.querySelector('svg')!)
    await expectNear(
      glyph(account).left - glyph(household).right,
      glyph(household).left - glyph(recipes).right,
    )

    // The logo folded away cleanly: the daily views sit centred in their pill.
    const primary = within(banner).getByRole('navigation', { name: 'Primary' })
    const today = within(primary).getByRole('link', { name: 'Today' })
    const pantry = within(primary).getByRole('link', { name: 'Pantry & shopping' })
    await waitFor(
      () => {
        const pill = box(primary.parentElement!)
        return expectNear(box(today).left - pill.left, pill.right - box(pantry).right)
      },
      { timeout: 1500 },
    )

    // One at a time: only the focused link's label opens.
    recipes.focus()
    await waitFor(() => expect(labelBox(recipes)).toBeGreaterThan(0), { timeout: 1500 })
    await expect(labelBox(household)).toBe(0)

    recipes.blur()
    window.scrollTo(0, 0)
    await waitFor(() => expect(banner).not.toHaveAttribute('data-scrolled'))
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
          'Desktop, no session — the right pill holds the sign-in / sign-up buttons and the theme toggle, the left one just the logo. With no nav links to carry the spacing, the right pill keeps its full 20px left padding; the play measures it.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const signIn = within(banner).getByRole('link', { name: 'Sign in' })
    const pill = signIn.closest('.md\\:rounded-full')!
    // 20px padding inside a 1px border.
    await expectNear(box(signIn).left - box(pill).left, 21)
  },
}
