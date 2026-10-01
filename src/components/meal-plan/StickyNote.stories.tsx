import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'
import { Body } from '@/components/ui/typography'
import { StickyNote } from './StickyNote'

const NOTE = 'Double the garlic — kids approved.'

const meta = {
  title: 'Meal plan/StickyNote',
  component: StickyNote,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    children: <Body variant="paragraph">{NOTE}</Body>,
  },
  decorators: [
    (Story) => (
      <div className="flex max-w-sm flex-col pt-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StickyNote>

export default meta
type Story = StoryObj<typeof meta>

/** Read-only, as on a past or read-only card: tilted, tape on, sized to its text. */
export const Static: Story = {
  play: async ({ canvasElement }) => {
    const slip = canvasElement.querySelector<HTMLElement>('[data-slot="sticky-note"]')!
    await expect(slip).toHaveAttribute('data-surface', 'sticky')
    // No border, no shadow: the slip is paper on the card, not a card in it.
    const style = getComputedStyle(slip)
    await expect(style.boxShadow).toBe('none')
    await expect(style.borderTopWidth).toBe('0px')
    // The tape overhangs the top edge.
    const tape = getComputedStyle(slip, '::before')
    await expect(tape.position).toBe('absolute')
    await expect(tape.width).toBe('44px')
  },
}

/** A saved note that opens the editor: the slip is the button, and straightens on hover and focus. */
export const Interactive: Story = {
  args: {
    variant: 'interactive',
    asChild: true,
    children: (
      <button type="button">
        <Body variant="paragraph">{NOTE}</Body>
      </button>
    ),
  },
  play: async ({ canvasElement }) => {
    const slip = within(canvasElement).getByRole('button', { name: NOTE })
    await expect(slip).toHaveAttribute('data-surface', 'sticky')
    slip.focus()
    await expect(slip).toHaveFocus()
  },
}

/** The editor's slip: straight, at the full width. */
export const Editing: Story = {
  args: {
    variant: 'editing',
    children: (
      <textarea
        aria-label="Note"
        defaultValue={NOTE}
        className="field-sizing-content w-full resize-none bg-transparent text-sm leading-normal outline-none"
      />
    ),
  },
}

/** A long note wraps inside the slip's max width rather than spanning the card. */
export const LongNote: Story = {
  args: {
    children: (
      <Body variant="paragraph">
        We usually double the garlic and swap lemon for lime. Took about an hour last time because
        the thighs were huge — worth pulling earlier next time.
      </Body>
    ),
  },
}

const HUES = [
  { label: 'Plain background', hue: null },
  { label: 'Chicken (52)', hue: 52 },
  { label: 'Beef (25)', hue: 25 },
  { label: 'Fish (230)', hue: 230 },
  { label: 'Vegetarian (145)', hue: 145 },
  { label: 'Neutral tint', hue: 'neutral' },
] as const

/** The slip on the plain background and on a few meal tints. Its own tokens win over the tint it sits on, so its text measures the same everywhere. */
export const OnMealTints: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {HUES.map(({ label, hue }) =>
        hue === null ? (
          <div key={label} className="flex flex-col gap-3 rounded-xl p-4">
            <Body variant="caption">{label}</Body>
            <StickyNote>
              <Body variant="paragraph">{NOTE}</Body>
            </StickyNote>
          </div>
        ) : (
          <div
            key={label}
            data-meal-surface={hue === 'neutral' ? 'neutral' : ''}
            style={hue === 'neutral' ? undefined : ({ '--meal-hue': hue } as CSSProperties)}
            className="flex flex-col gap-3 rounded-xl p-4"
          >
            <Body variant="caption">{label}</Body>
            <StickyNote>
              <Body variant="paragraph">{NOTE}</Body>
            </StickyNote>
          </div>
        ),
      )}
    </div>
  ),
  play: async ({ canvasElement }) => {
    // Every slip resolves the same background, whatever tint it sits on.
    const slips = [...canvasElement.querySelectorAll<HTMLElement>('[data-slot="sticky-note"]')]
    await expect(slips).toHaveLength(HUES.length)
    const colours = new Set(slips.map((slip) => getComputedStyle(slip).backgroundColor))
    await expect(colours.size).toBe(1)
  },
}

export const OnMealTintsDark: Story = {
  ...OnMealTints,
  name: 'On meal tints (dark)',
  globals: { theme: 'dark' },
}
