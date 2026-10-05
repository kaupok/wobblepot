import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
          Meal plan
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
 * it: a range from the first text node to the last. The logo has no text
 * node, so for it the box is the wordmark SVG's own, which is its ink box.
 */
function textBox(el: HTMLElement) {
  const wordmark = el.querySelector('svg[aria-label="Wobblepot"]')
  if (wordmark) return wordmark.getBoundingClientRect()
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
    pastMealsToMark: 0,
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
    // Nothing to mark: the account icon has no dot and its plain name.
    await expect(within(banner).getByRole('button', { name: 'User menu' })).toBeVisible()
    await expect(banner.querySelector('[data-slot="attention-dot"]')).toBeNull()
  },
}

/** The dot on the visible account trigger, its box, and the box around it. */
function visibleDot(banner: HTMLElement) {
  const trigger = within(banner).getByRole('button', { name: 'User menu, past meals to mark' })
  const dot = trigger.querySelector('[data-slot="attention-dot"]') as HTMLElement
  return { trigger, dot }
}

/** `inner` lies wholly inside `outer`, to within a pixel of rounding. */
function contains(outer: DOMRect, inner: DOMRect) {
  return (
    inner.left >= outer.left - 1 &&
    inner.right <= outer.right + 1 &&
    inner.top >= outer.top - 1 &&
    inner.bottom <= outer.bottom + 1
  )
}

export const PastMealsToMark: Story = {
  args: { session: authedSession, hasHousehold: true, pastMealsToMark: 4 },
  parameters: {
    docs: {
      description: {
        story:
          'Past meals are still to mark (HON-1028): a red dot at the top-right of the account icon, and the trigger is named "User menu, past meals to mark". Scrolled, the phone pill draws in to the 56px disc around the icon, and the dot stays whole inside it. The play measures the dot inside the trigger and inside the pill, at rest and scrolled.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const { trigger, dot } = visibleDot(banner)
    await expect(dot).toBeVisible()
    await expect(dot).toHaveAttribute('aria-hidden', 'true')
    // The phone pill: the one element with the unprefixed float shadow.
    const pill = banner.querySelector('.shadow-float') as HTMLElement
    await expect(contains(box(trigger), box(dot))).toBe(true)
    await expect(contains(box(pill), box(dot))).toBe(true)

    window.scrollTo(0, 400)
    await waitFor(() => expect(banner).toHaveAttribute('data-scrolled'))
    // Wait for the pill to finish drawing in to the 56px disc.
    await waitFor(() => expect(Math.round(box(pill).width)).toBe(56), { timeout: 1500 })
    await expect(dot).toBeVisible()
    await expect(contains(box(pill), box(dot))).toBe(true)

    window.scrollTo(0, 0)
    await waitFor(() => expect(banner).not.toHaveAttribute('data-scrolled'))
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
          'Desktop layout — the phone pill dissolves into two: logo and daily views left, settings views and account menu right. Exercises the `md:` breakpoint where layout branches. The space between links is the links’ own padding, not a gap, so neighbours share an edge; the play measures that the labels still sit 24px apart and 28px in from the pill’s edge (HON-922).',
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
    const mealPlan = within(primary).getByRole('link', { name: 'Meal plan' })
    const pantry = within(primary).getByRole('link', { name: 'Pantry & shopping' })
    const recipes = within(settings).getByRole('link', { name: 'My recipes' })
    const household = within(settings).getByRole('link', { name: 'Household' })

    // 28px padding inside a 1px border, at both ends of the left pill and
    // the start of the right one.
    await expectNear(logo.left - leftPill.left, 29)
    await expectNear(leftPill.right - textBox(pantry).right, 29)
    await expectNear(textBox(recipes).left - rightPill.left, 29)
    // 24px between labels, as when it was a `gap-6`.
    await expectNear(textBox(mealPlan).left - logo.right, 24)
    await expectNear(textBox(pantry).left - textBox(mealPlan).right, 24)
    await expectNear(textBox(household).left - textBox(recipes).right, 24)
    // ...but the links themselves touch.
    await expectNear(box(pantry).left, box(mealPlan).right)
    await expectNear(box(household).left, box(recipes).right)
  },
}

export const DesktopPastMealsToMark: Story = {
  args: { session: authedSession, hasHousehold: true, pastMealsToMark: 4 },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'From `md`: the same dot on the account icon in the right pill, and beside Past meals in its dropdown (HON-1028).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const { trigger, dot } = visibleDot(banner)
    await expect(dot).toBeVisible()
    await expect(contains(box(trigger), box(dot))).toBe(true)

    await userEvent.click(trigger)
    const row = await within(document.body).findByRole('menuitem', {
      name: /^Past meals\s*\(to mark\)$/,
    })
    // The menu fades in from opacity 0, so wait for the dot to be visible.
    await waitFor(() => expect(row.querySelector('[data-slot="attention-dot"]')).toBeVisible())
    await userEvent.keyboard('{Escape}')
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
    // Folded, the pill pads both ends alike: the first icon box sits as far
    // in from the left edge as the account disc does from the right.
    const settingsPill = settingsNav.parentElement!
    await waitFor(
      () =>
        expectNear(
          box(recipes).left - box(settingsPill).left,
          box(settingsPill).right - box(account).right,
        ),
      { timeout: 1500 },
    )

    // The logo folded away cleanly: the daily views sit centred in their pill.
    const primary = within(banner).getByRole('navigation', { name: 'Primary' })
    const mealPlan = within(primary).getByRole('link', { name: 'Meal plan' })
    const pantry = within(primary).getByRole('link', { name: 'Pantry & shopping' })
    await waitFor(
      () => {
        const pill = box(primary.parentElement!)
        return expectNear(box(mealPlan).left - pill.left, pill.right - box(pantry).right)
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

/**
 * The `md` breakpoint exactly (768px), the narrowest width the two pills
 * share, with the navigation landmarks and the last folding link named in
 * the story's locale.
 */
const atMd = (
  locale: 'en' | 'et',
  names: { primary: string; settings: string; recipes: string; household: string },
): Story => ({
  args: { session: authedSession, hasHousehold: true },
  globals: {
    locale,
    viewport: { value: 'tabletPortrait', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'The `md` breakpoint exactly (768px), the narrowest width the two pills share. "Meal plan" / "Söögiplaan" is wider than the "Today" / "Täna" it replaced (HON-924), and with every label open the two pills no longer fit side by side here. So below `lg` the right pill rests folded, My recipes and Household closed to their icons as they are when scrolled, and a label opens only for the hovered or focused link. The play measures that the pills do not overlap, at rest and scrolled, that at rest the logo and the left pill\'s labels are not clipped to make them fit, and that focusing a folded link opens its label alone.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const primary = within(banner).getByRole('navigation', { name: names.primary })
    const settings = within(banner).getByRole('navigation', { name: names.settings })
    const recipes = within(settings).getByRole('link', { name: names.recipes })
    const household = within(settings).getByRole('link', { name: names.household })
    // The label's clipping box: the link's last child (icon box, label box).
    const labelBox = (link: HTMLElement) => link.lastElementChild!.getBoundingClientRect().width
    // Widths depend on the face: measured on the fallback before Geist swaps
    // in, the pills come out a different width than they render.
    await document.fonts.ready

    const expectNoOverlap = () =>
      // Within a pixel: subpixel text widths round differently per browser.
      expect(
        box(settings.parentElement!).left - box(primary.parentElement!).right,
      ).toBeGreaterThanOrEqual(-1)

    // At rest the right pill is already folded, and the open labels fit. A
    // pill squeezed past its content shrinks its clipped boxes (the logo,
    // the labels) rather than overflowing, so an overlap can also show up
    // as a clipped label.
    await expect(labelBox(recipes)).toBe(0)
    await expect(labelBox(household)).toBe(0)
    await expectNoOverlap()
    const logo = within(banner).getByRole('link', { name: 'Wobblepot' }).parentElement!
    const leftLabels = Array.from(primary.querySelectorAll('a'))
    for (const el of [logo, ...leftLabels]) {
      await expect(el.scrollWidth - el.clientWidth).toBeLessThanOrEqual(1)
    }
    // Folded, the links keep their names.
    await expect(recipes).toHaveAccessibleName(names.recipes)
    await expect(household).toHaveAccessibleName(names.household)

    // Focus opens one label, and the pills still fit with it open.
    recipes.focus()
    await waitFor(() => expect(labelBox(recipes)).toBeGreaterThan(0), { timeout: 1500 })
    await expect(labelBox(household)).toBe(0)
    await expectNoOverlap()
    recipes.blur()
    await waitFor(() => expect(labelBox(recipes)).toBe(0), { timeout: 1500 })

    window.scrollTo(0, 400)
    await waitFor(() => expect(banner).toHaveAttribute('data-scrolled'))
    await expect(labelBox(household)).toBe(0)
    await expectNoOverlap()

    window.scrollTo(0, 0)
    await waitFor(() => expect(banner).not.toHaveAttribute('data-scrolled'))
  },
})

export const DesktopAtMd: Story = atMd('en', {
  primary: 'Primary',
  settings: 'Settings',
  recipes: 'My recipes',
  household: 'Household',
})

export const DesktopAtMdEstonian: Story = atMd('et', {
  primary: 'Põhinavigatsioon',
  settings: 'Sätted',
  recipes: 'Minu retseptid',
  household: 'Leibkond',
})

export const DesktopLoggedOut: Story = {
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop, no session — the right pill holds the sign-in / sign-up buttons and the theme toggle, the left one just the logo. With no nav links, the pill’s 8px meets the Sign in button’s own box, so its hover pill sits as far in from the left edge as the theme disc does from the right (HON-939); the play measures both ends.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const signIn = within(banner).getByRole('link', { name: 'Sign in' })
    const theme = within(banner).getByRole('button', { name: 'Toggle theme' })
    const pill = box(signIn.closest('.md\\:rounded-full')!)
    // 8px padding inside a 1px border, the same at both ends.
    await expectNear(box(signIn).left - pill.left, 9)
    await expectNear(pill.right - box(theme).right, 9)
  },
}

export const DesktopOnboarding: Story = {
  args: { session: authedSession, hasHousehold: false },
  globals: {
    viewport: { value: 'desktop', isRotated: false },
  },
  parameters: {
    docs: {
      description: {
        story:
          'Desktop, signed in without a household — the right pill holds only the account disc. The pill’s 8px meets the disc’s box at both ends, so it sits centred in the pill (HON-939); the play measures it.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const banner = within(canvasElement).getByRole('banner')
    const account = within(banner).getByRole('button', { name: 'User menu' })
    const pill = box(account.closest('.md\\:rounded-full')!)
    // 8px padding inside a 1px border, the same at both ends.
    await expectNear(box(account).left - pill.left, 9)
    await expectNear(pill.right - box(account).right, 9)
  },
}
