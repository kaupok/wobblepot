import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AlertTriangle, Check, Info, ThumbsDown } from 'lucide-react'
import { expect, within } from 'storybook/test'
import { Body, Heading } from './typography'

/**
 * Semantic status tokens live in `src/app/globals.css`. Each family has an
 * emphasis value (text and icons) and a `-muted` tinted surface; borders use an
 * opacity modifier on the emphasis token rather than a token of their own.
 *
 * Every swatch below renders real text on its real surface, so the axe
 * `color-contrast` gate measures the pairings for us in both themes. That is the
 * point of this file: it is the contrast regression test for the tokens.
 */
const meta: Meta = {
  title: 'UI/Tokens',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Status colour tokens. Switch the theme in the toolbar to check both palettes. Domain meaning (available, missing, staple) belongs in component props and copy, never in a token name.',
      },
    },
  },
}

export default meta
type Story = StoryObj

type StatusName = 'success' | 'warning' | 'info'

const STATUSES: {
  name: StatusName
  label: string
  usage: string
  surface: string
  emphasis: string
  border: string
  Icon: typeof Check
}[] = [
  {
    name: 'success',
    label: 'Success',
    usage: 'Ingredient in the pantry, import matched, password reset sent.',
    surface: 'bg-success-muted',
    emphasis: 'text-success',
    border: 'border-success/30',
    Icon: Check,
  },
  {
    name: 'warning',
    label: 'Warning',
    usage: 'Ingredient missing, import needs review, meal is unrated.',
    surface: 'bg-warning-muted',
    emphasis: 'text-warning',
    border: 'border-warning/30',
    Icon: AlertTriangle,
  },
  {
    name: 'info',
    label: 'Info',
    usage: 'Servings overridden, low-confidence match, neutral annotation.',
    surface: 'bg-info-muted',
    emphasis: 'text-info',
    border: 'border-info/30',
    Icon: Info,
  },
]

function StatusTokensView() {
  return (
    <div className="flex flex-col gap-6">
      {STATUSES.map(({ name, label, usage, surface, emphasis, border, Icon }) => (
        <div key={name} className="flex flex-col gap-2">
          <div>
            <Heading variant="h4">{label}</Heading>
          </div>
          <div>
            <Body variant="muted">{usage}</Body>
          </div>
          <div className={`flex items-center gap-2 rounded-lg border p-3 ${surface} ${border}`}>
            <Icon className={`h-4 w-4 shrink-0 ${emphasis}`} />
            <Body variant="small" className={emphasis}>
              {emphasis} on {surface} with {border}
            </Body>
          </div>
          <div className="flex flex-wrap gap-2">
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${surface} ${emphasis}`}
            >
              Pill
            </span>
            <span className={`text-xs font-medium ${emphasis}`}>Emphasis on the page surface</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function OnBackgroundView() {
  return (
    <div className="flex flex-col gap-3">
      {STATUSES.map(({ name, emphasis, Icon }) => (
        <div key={name} className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 ${emphasis}`} />
          <Body className={emphasis}>The quick brown fox jumps over the lazy dog</Body>
        </div>
      ))}
    </div>
  )
}

/**
 * Red is not part of the status family — it stays on the existing `destructive`
 * token so a failure never reads as one more status.
 *
 * The tinted `bg-destructive/10` surface is icon-only on purpose. `destructive`
 * is tuned as a fill colour (white text on a red button), not as text on a red
 * tint: it measures 3.99:1 in light, which clears the 3:1 non-text minimum but
 * not the 4.5:1 text threshold. Every shipped usage of the tint is an icon
 * (`MealRating`). Emphasis text on the page surface is 4.76:1 and is fine.
 */
function DestructiveView() {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-destructive/10 inline-flex h-6 w-6 items-center justify-center rounded-full">
        <ThumbsDown className="text-destructive h-3.5 w-3.5" role="img" aria-label="Disliked" />
      </span>
      <Body className="text-destructive">Destructive emphasis on the page surface</Body>
    </div>
  )
}

/**
 * The `touch` spacing token (`--spacing-touch` in `globals.css`) is the minimum
 * tap height for interactive list rows and tab items. It is a literal pixel
 * value, not a rem: the rule is a physical finger-size floor, so it must not
 * scale with the root font size.
 *
 * The play function measures the rendered box rather than asserting on the class
 * name — a token that silently stopped resolving would still produce the right
 * class and the wrong height. It reads the value as a number rather than the
 * `'…px'` string so that the HON-609 acceptance grep for a literal pixel value
 * under `src/**\/*.tsx` stays a meaningful signal.
 */
/** The value of `--spacing-touch`, as the play function expects to measure it. */
const TOUCH_TARGET_PX = 44

function TouchTargetView() {
  return (
    <div className="flex flex-col gap-3">
      <div data-testid="touch-row" className="min-h-touch flex items-center rounded-lg border px-3">
        <Body variant="small">min-h-touch — a list row at the touch floor</Body>
      </div>
      <div className="flex items-center gap-3">
        <div data-testid="touch-square" className="size-touch rounded-md border" />
        <Body variant="muted">size-touch — a square icon target</Body>
      </div>
    </div>
  )
}

/**
 * Light and dark are separate stories on purpose. The axe gate only measures the
 * theme a story actually renders in, so the dark values would go unchecked if the
 * toolbar were the only way to reach them.
 */
export const StatusTokens: Story = { render: () => <StatusTokensView /> }

export const StatusTokensDark: Story = {
  render: () => <StatusTokensView />,
  globals: { theme: 'dark' },
}

export const OnBackground: Story = { render: () => <OnBackgroundView /> }

export const OnBackgroundDark: Story = {
  render: () => <OnBackgroundView />,
  globals: { theme: 'dark' },
}

export const Destructive: Story = {
  render: () => <DestructiveView />,
  parameters: {
    docs: {
      description: {
        story:
          'Red is not a status token — failure stays on `destructive` so it never reads as one more status. The tinted `bg-destructive/10` surface is icon-only on purpose: `destructive` is tuned as a fill colour (white text on a red button), not as text on a red tint, and measures 3.99:1 in light. That clears the 3:1 non-text minimum but not the 4.5:1 text threshold, and every shipped usage of the tint is an icon (`MealRating`). Emphasis text on the page surface is 4.76:1.',
      },
    },
  },
}

export const DestructiveDark: Story = {
  render: () => <DestructiveView />,
  globals: { theme: 'dark' },
}

export const TouchTarget: Story = {
  render: () => <TouchTargetView />,
  parameters: {
    docs: {
      description: {
        story:
          'The `touch` spacing token names the minimum tap height for list rows and tab items, so `min-h-touch` / `h-touch` / `size-touch` replace a copied `min-h-[…]` arbitrary value. Shipped in HON-609; `docs/DESIGN.md` → Spacing, radius, elevation carries the rule and the value.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = await canvas.findByTestId('touch-row')
    const square = await canvas.findByTestId('touch-square')

    // Asserted separately from the box: a failure on min-height means the token
    // stopped resolving, a failure on the box alone means the row's content grew
    // past the floor. Same number, two different bugs.
    expect(parseFloat(getComputedStyle(row).minHeight)).toBe(TOUCH_TARGET_PX)
    expect(row.getBoundingClientRect().height).toBe(TOUCH_TARGET_PX)
    expect(square.getBoundingClientRect().height).toBe(TOUCH_TARGET_PX)
    expect(square.getBoundingClientRect().width).toBe(TOUCH_TARGET_PX)
  },
}
