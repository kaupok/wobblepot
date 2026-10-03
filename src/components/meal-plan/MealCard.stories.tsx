import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { MealType } from '@/generated/prisma/enums'
import {
  createMeal,
  lemonGarlicChickenComponents,
  lemonGarlicChickenPantry,
  lemonGarlicChickenPantryItems,
} from '@/stories/fixtures'
import mealIllustration from '@/stories/assets/meal-illustration-white.png'
import { awaitDialogClosed, pressEscape } from '@/stories/a11y-helpers'
import { defaultHandlers } from '@/stories/msw-handlers'
import type { AlternativeMeal } from './types'
import { MealCard } from './MealCard'

const mealFixture = createMeal()

/**
 * Card widths. `phone` is a 390px screen less the page's `px-4`; `desktop` is
 * the planner column at the 1152px page width, 1fr beside the 320px sidebar.
 */
const CARD_WIDTH = {
  default: 'max-w-xs',
  phone: 'w-[358px]',
  desktop: 'w-[776px]',
} as const

const meta = {
  title: 'Meal plan/MealCard',
  component: MealCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    entryId: 'entry-1',
    planId: 'plan-1',
    mealType: MealType.dinner,
    householdSize: 4,
    pantryIngredients: lemonGarlicChickenPantry,
    pantryItems: lemonGarlicChickenPantryItems,
  },
  decorators: [
    // `cardWidth` pins a planner column's real width for the geometry stories.
    (Story, { parameters }) => (
      <div className={CARD_WIDTH[(parameters.cardWidth as keyof typeof CARD_WIDTH) ?? 'default']}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MealCard>

export default meta
type Story = StoryObj<typeof meta>

/** Swap and Clear live behind the card's "More actions" menu (HON-688). */
async function openMoreActions(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /more actions/i }))
}

const DESCRIPTION = 'Sheet-pan chicken thighs with crisp skin and bright citrus.'

/** A meal with an illustration takes its hue (HON-746); the controls stay where they were. */
export const PlannedWithImage: Story = {
  args: {
    meal: {
      ...mealFixture,
      description: DESCRIPTION,
      imageStatus: 'ready',
      imageUrl: mealIllustration.src,
      imageHue: 52,
    },
    status: 'planned',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: mealFixture.name })
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await expect(card.style.getPropertyValue('--meal-hue')).toBe('52')
    // Every card has this menu, so its name carries the meal (HON-807).
    const menu = canvas.getByRole('button', { name: `More actions: ${mealFixture.name}` })
    await expect(menu).toBeVisible()
    // The image ends before the menu, and the title and the description wrap
    // before the image's opaque part (HON-749).
    const box = canvas.getByTestId('meal-card-image').getBoundingClientRect()
    const title = canvas.getByRole('heading', { name: mealFixture.name }).getBoundingClientRect()
    const description = canvas.getByText(DESCRIPTION).getBoundingClientRect()
    await expect(menu.getBoundingClientRect().left).toBeGreaterThanOrEqual(box.right)
    await expect(title.right).toBeLessThanOrEqual(box.left + box.width * 0.3)
    await expect(description.right).toBeLessThanOrEqual(box.left + box.width * 0.3)
    // Nothing runs across the width below the head, so the plate runs the
    // card's full height, inside its border, unfaded (HON-927).
    const cardBox = card.getBoundingClientRect()
    await expect(box.top).toBeCloseTo(cardBox.top + card.clientTop, 0)
    await expect(box.bottom).toBeCloseTo(cardBox.bottom - card.clientTop, 0)
    // The pantry's verdict is a surface badge: the page background, no ring.
    const availability = canvas.getByText(/ingredients to buy|have all/i)
    await expect(availability).toHaveAttribute('data-variant', expect.stringMatching(/^surface-/))
    await expect(getComputedStyle(availability).borderTopColor).toBe('rgba(0, 0, 0, 0)')
  },
}

/**
 * A click anywhere on the card opens the cook view, the plate included, not
 * only the name (HON-1010). A hover anywhere underlines the name and darkens
 * the border; the name stays the keyboard target, and the card draws its
 * focus ring.
 */
export const ClickAnywhereOpensCookView: Story = {
  args: PlannedWithImage.args,
  parameters: {
    msw: {
      handlers: {
        // Opening a planned meal generates its steps on open.
        tips: [
          http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () =>
            HttpResponse.json({ tips: { equipment: [], steps: ['Roast'], pitfalls: [] } }),
          ),
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    await canvas.findByRole('img', { name: mealFixture.name })
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    // A synthetic hover does not reach CSS `:hover`, so the hover look is
    // asserted by class in MealCard.test.tsx; the pointer cursor is not hover.
    await expect(getComputedStyle(card).cursor).toBe('pointer')
    await expect(getComputedStyle(card).boxShadow).toBe('none')

    await userEvent.click(canvas.getByTestId('meal-card-image'))
    await expect(await body.findByRole('dialog', { name: mealFixture.name })).toBeInTheDocument()
    await pressEscape()
    await awaitDialogClosed()

    // One ring, the card's, while the name has keyboard focus.
    const name = canvas.getByRole('button', { name: mealFixture.name })
    name.focus()
    await expect(name).toHaveFocus()
    await expect(name.matches(':focus-visible')).toBe(true)
    await expect(getComputedStyle(card).boxShadow).not.toBe('none')
    await expect(getComputedStyle(name).outlineStyle).toBe('none')
  },
}

/**
 * One of the household's own recipes: the bare "My recipe" icon follows the
 * meal name's last word, with a tooltip, and the badge row keeps only the slot
 * and the protein (HON-973). A library meal (every other story) has none.
 */
export const OwnRecipe: Story = {
  args: {
    meal: {
      ...mealFixture,
      primaryProteinType: 'poultry',
      isCustom: true,
      imageStatus: 'ready',
      imageUrl: mealIllustration.src,
      imageHue: 150,
    },
    status: 'planned',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const icon = canvas.getByRole('button', { name: 'My recipe' })
    await expect(icon).not.toHaveAttribute('title')
    // Not in the badge row: that ends with the protein.
    await expect(icon.closest('[data-slot="badge"]')).toBeNull()
    const protein = canvas.getByText('Poultry')
    const row = [...protein.parentElement!.querySelectorAll('[data-slot="badge"]')]
    await expect(row.at(-1)).toBe(protein)

    // After the name, on its last line, and inside the heading beside the
    // name's button rather than in it.
    const heading = canvas.getByRole('heading', { level: 3 })
    await expect(heading).toContainElement(icon)
    const name = canvas.getByRole('button', { name: mealFixture.name })
    await expect(name).not.toContainElement(icon)
    const iconBox = icon.getBoundingClientRect()
    const headingBox = heading.getBoundingClientRect()
    await expect(headingBox.bottom - iconBox.bottom).toBeLessThan(iconBox.height)

    // The icon stacks over the name's button: hover opens the tooltip, and the
    // name still opens the cook view.
    await userEvent.hover(icon)
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('My recipe')
    await userEvent.unhover(icon)
  },
}

export const OwnRecipeDark: Story = {
  ...OwnRecipe,
  name: 'Own recipe (dark)',
  globals: { theme: 'dark' },
  play: undefined,
}

const NOTE = 'Double the garlic — kids approved.'

/** Whether two boxes share any area. */
function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/**
 * The note lies over the card as a slip rather than taking a row (HON-974):
 * the slip's box is inside the card's, it keeps clear of the meal name, the ⋯
 * menu and the availability badge, and the image, if there is one, still runs
 * the card's full height, inside its border, with nothing below the head to
 * end it.
 */
async function assertSlipOverCard(
  card: HTMLElement,
  slip: HTMLElement,
  name: string = mealFixture.name,
) {
  // The fallback font sets wider, so geometry is only meaningful once the
  // web font has landed.
  await document.fonts.ready
  const inCard = within(card)
  const cardBox = card.getBoundingClientRect()
  const slipBox = slip.getBoundingClientRect()
  await expect(slipBox.top).toBeGreaterThanOrEqual(cardBox.top)
  await expect(slipBox.bottom).toBeLessThanOrEqual(cardBox.bottom)
  await expect(slipBox.left).toBeGreaterThanOrEqual(cardBox.left)
  await expect(slipBox.right).toBeLessThanOrEqual(cardBox.right)
  // By structure rather than copy, so the Estonian story checks the same
  // things: the name, the ⋯ trigger and every badge (slot, protein, pantry).
  const clearOf = [
    inCard.getByRole('button', { name }),
    ...card.querySelectorAll<HTMLElement>('[aria-haspopup="menu"], [data-slot="badge"]'),
  ]
  for (const element of clearOf) {
    const box = element.getBoundingClientRect()
    await expect(
      overlaps(slipBox, box),
      `slip ${JSON.stringify(slipBox)} over ${element.textContent} ${JSON.stringify(box)}`,
    ).toBe(false)
  }
  const image = inCard.queryByTestId('meal-card-image')?.getBoundingClientRect()
  if (!image) return
  await expect(image.top).toBeCloseTo(cardBox.top + card.clientTop, 0)
  await expect(image.bottom).toBeCloseTo(cardBox.bottom - card.clientTop, 0)
}

/**
 * A planned card with a note: the note is a slip over the plate's bottom-right
 * corner, so the plate keeps the card's full height (HON-974).
 */
export const PlannedWithImageAndNote: Story = {
  args: {
    meal: { ...mealFixture, imageStatus: 'ready', imageUrl: mealIllustration.src, imageHue: 52 },
    status: 'planned',
    note: NOTE,
  },
  parameters: { cardWidth: 'phone' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: mealFixture.name })
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await assertSlipOverCard(card, canvas.getByRole('button', { name: NOTE }))
  },
}

/**
 * Opening the slip edits the note where it lies: the editor stays over the
 * card, and a note typed past one line scrolls in the textarea rather than
 * growing the card (HON-974).
 */
export const EditingKeepsTheCard: Story = {
  ...PlannedWithImageAndNote,
  name: 'Editing keeps the card (phone)',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: mealFixture.name })
    // A web font that lands mid-story rewraps the title, and with it the card.
    await document.fonts.ready
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const before = card.getBoundingClientRect()
    await userEvent.click(canvas.getByRole('button', { name: NOTE }))
    const textarea = await canvas.findByRole('textbox', { name: /note/i })
    await userEvent.type(
      textarea,
      ' Roast the lemons cut side down, and keep the pan juices for the rice.',
    )
    const editor = textarea.closest<HTMLElement>('[data-surface="sticky"]')!
    await expect(editor).toHaveAttribute('data-variant', 'editing')
    const after = card.getBoundingClientRect()
    await expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2)
    const editorBox = editor.getBoundingClientRect()
    await expect(editorBox.top).toBeGreaterThanOrEqual(after.top)
    await expect(editorBox.bottom).toBeLessThanOrEqual(after.bottom)
    // The editor keeps clear of the ⋯ column, as the slip does.
    const menu = canvas.getByRole('button', { name: /^more actions/i })
    await expect(overlaps(editorBox, menu.getBoundingClientRect())).toBe(false)
    await expect(canvas.getByRole('button', { name: /^save$/i })).toBeVisible()
  },
}

/**
 * The same meal with and without a note, in the desktop planner column. The
 * note lies over the plate and adds no row, so the two cards are the same
 * height (HON-974).
 */
export const NoteKeepsThePlate: Story = {
  name: 'Note keeps the plate (desktop)',
  args: {
    meal: {
      ...mealFixture,
      description: DESCRIPTION,
      imageStatus: 'ready',
      imageUrl: mealIllustration.src,
      imageHue: 52,
    },
    status: 'planned',
  },
  parameters: { cardWidth: 'desktop' },
  render: (args) => (
    <div className="flex flex-col gap-4">
      <div data-testid="without-note">
        <MealCard {...args} />
      </div>
      <div data-testid="with-note">
        <MealCard {...args} entryId="entry-2" note={NOTE} />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByTestId('meal-card-image')).toHaveLength(2))
    const cardIn = (id: string) =>
      canvas.getByTestId(id).querySelector<HTMLElement>('[data-slot="card"]')!
    const plain = cardIn('without-note')
    const noted = cardIn('with-note')
    const height = (card: HTMLElement) => card.getBoundingClientRect().height
    await expect(Math.abs(height(noted) - height(plain))).toBeLessThanOrEqual(2)
    await assertSlipOverCard(noted, within(noted).getByRole('button', { name: NOTE }))
  },
}

/** The same pair on a phone, where the slip has under half the card to lie on. */
export const NoteKeepsThePlatePhone: Story = {
  ...NoteKeepsThePlate,
  name: 'Note keeps the plate (phone)',
  parameters: { cardWidth: 'phone' },
}

/** In Estonian, whose availability badge is the widest, the slip still clears it. */
export const NoteKeepsThePlatePhoneEstonian: Story = {
  ...NoteKeepsThePlatePhone,
  name: 'Note keeps the plate (phone, Estonian)',
  globals: { locale: 'et' },
}

/**
 * A servings override adds a second badge after the pantry one. On a phone
 * the two no longer fit beside the slip, so the row wraps, and the slip keeps
 * clear of both (HON-974).
 */
export const NoteWithServingOverridePhone: Story = {
  ...PlannedWithImageAndNote,
  name: 'Note with a serving override (phone)',
  args: { ...PlannedWithImageAndNote.args, servingOverride: 6 },
}

export const NoteWithServingOverridePhoneEstonian: Story = {
  ...NoteWithServingOverridePhone,
  name: 'Note with a serving override (phone, Estonian)',
  globals: { locale: 'et' },
}

const SHORT_NAME = 'Pasta'
const LONG_NOTE =
  'Use the big pot, salt the water well, and save a cup of the pasta water for the sauce before you drain it.'

/**
 * A short phone card with a full first row: the slip runs up beside it, so
 * the protein and own-recipe badges wrap before the slip rather than under
 * it. Estonian, whose protein label is the longer one (HON-974).
 */
export const ShortPhoneCardWithFullFirstRow: Story = {
  name: 'Short card with a full first row (phone, Estonian)',
  args: {
    meal: {
      ...mealFixture,
      name: SHORT_NAME,
      description: null,
      primaryProteinType: 'dairy',
      isCustom: true,
      imageStatus: 'ready',
      imageUrl: mealIllustration.src,
      imageHue: 52,
    },
    mealType: MealType.breakfast,
    status: 'planned',
    note: LONG_NOTE,
    pantryIngredients: [{ ingredientId: 'salt', isStaple: true }],
  },
  parameters: { cardWidth: 'phone' },
  globals: { locale: 'et' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: SHORT_NAME })
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await assertSlipOverCard(card, canvas.getByRole('button', { name: LONG_NOTE }), SHORT_NAME)
  },
}

/**
 * The shortest planner card: a one-word name, no description and no pantry
 * badge (a staples-only pantry shows none). A long saved note still fits on it,
 * clamped, and so does the editor with that note open: it scrolls rather than
 * rising past the card's top edge, where an image card would clip it (HON-974).
 */
export const ShortestCardWithLongNote: Story = {
  name: 'Shortest card with a long note (desktop)',
  args: {
    meal: {
      ...mealFixture,
      name: SHORT_NAME,
      description: null,
      imageStatus: 'ready',
      imageUrl: mealIllustration.src,
      imageHue: 52,
    },
    status: 'planned',
    note: LONG_NOTE,
    pantryIngredients: [{ ingredientId: 'salt', isStaple: true }],
  },
  parameters: { cardWidth: 'desktop' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: SHORT_NAME })
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await assertSlipOverCard(card, canvas.getByRole('button', { name: LONG_NOTE }), SHORT_NAME)
    const before = card.getBoundingClientRect()

    await userEvent.click(canvas.getByRole('button', { name: LONG_NOTE }))
    const textarea = await canvas.findByRole('textbox', { name: /note/i })
    const editor = textarea.closest<HTMLElement>('[data-surface="sticky"]')!
    const after = card.getBoundingClientRect()
    await expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2)
    const editorBox = editor.getBoundingClientRect()
    await expect(editorBox.top).toBeGreaterThanOrEqual(after.top)
    await expect(editorBox.bottom).toBeLessThanOrEqual(after.bottom)
    await expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight)
  },
}

/** The overlay wrapper a card's note slip lies in, which carries its placement (HON-975). */
function noteOverlay(card: HTMLElement) {
  return card.querySelector<HTMLElement>('[data-slot="meal-image-overlay"]')!
}

/**
 * Three cards with notes, side by side: each slip rests at its own offset and
 * tilt from its entry id, and every one still lies inside its card, clear of
 * the name, the ⋯ menu and the badges (HON-975).
 */
export const ScatteredNotes: Story = {
  name: 'Scattered notes (phone)',
  args: {
    meal: {
      ...mealFixture,
      description: DESCRIPTION,
      imageStatus: 'ready',
      imageUrl: mealIllustration.src,
      imageHue: 52,
    },
    status: 'planned',
  },
  parameters: { cardWidth: 'phone' },
  render: (args) => (
    <div className="flex flex-col gap-4">
      {['entry-1', 'entry-2', 'entry-3'].map((entryId) => (
        <div key={entryId} data-testid={entryId}>
          <MealCard {...args} entryId={entryId} note={NOTE} />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getAllByTestId('meal-card-image')).toHaveLength(3))
    const placements = new Set<string>()
    for (const entryId of ['entry-1', 'entry-2', 'entry-3']) {
      const card = canvas.getByTestId(entryId).querySelector<HTMLElement>('[data-slot="card"]')!
      const overlay = noteOverlay(card)
      placements.add(
        ['--note-x', '--note-y', '--note-tilt']
          .map((name) => overlay.style.getPropertyValue(name))
          .join(' '),
      )
      await assertSlipOverCard(card, within(card).getByRole('button', { name: NOTE }))
    }
    await expect(placements.size).toBe(3)
  },
}

/** The PATCH bodies the note stories' entry handler received. */
let notePatches: Record<string, unknown>[] = []

/** Records every entry PATCH, answering with `status`, ahead of the default handlers. */
function notePatchHandlers(status = 200) {
  return {
    default: [
      http.patch('/api/meal-plans/:planId/entries/:entryId', async ({ request }) => {
        notePatches.push((await request.json()) as Record<string, unknown>)
        return status === 200
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ error: 'Failed' }, { status })
      }),
      ...defaultHandlers,
    ],
  }
}

/** The patches that moved the note, rather than editing it. */
function notePositionPatches() {
  return notePatches.filter((body) => 'noteX' in body)
}

/**
 * Where the slip lies on its card: the box of the overlay that hugs it,
 * relative to the card's. The overlay, not the slip: focusing the slip
 * straightens it over 200ms, which changes its tilted box without moving it.
 * Relative to the card: the desktop card is wider than the test viewport, and
 * focusing the slip can scroll the page sideways.
 */
function slipInCard(card: HTMLElement) {
  const box = noteOverlay(card).getBoundingClientRect()
  const cardBox = card.getBoundingClientRect()
  return { left: box.left - cardBox.left, top: box.top - cardBox.top }
}

/** Presses the slip at its centre, moves by `dx`/`dy`, and lets go. */
async function dragSlip(slip: HTMLElement, dx: number, dy: number) {
  const box = slip.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  await userEvent.pointer([
    { keys: '[MouseLeft>]', target: slip, coords: { clientX: x, clientY: y } },
    { coords: { clientX: x + dx / 2, clientY: y + dy / 2 } },
    { coords: { clientX: x + dx, clientY: y + dy } },
    { keys: '[/MouseLeft]' },
  ])
}

/** A name that wraps to two lines, so the card has room to move the slip up in. */
const LONG_NAME = 'Lemon garlic chicken with roasted potatoes and green beans'

const tallNotedCard = {
  meal: {
    ...mealFixture,
    name: LONG_NAME,
    description: DESCRIPTION,
    imageStatus: 'ready' as const,
    imageUrl: mealIllustration.src,
    imageHue: 52,
  },
  status: 'planned' as const,
  note: NOTE,
}

/**
 * Dragging the slip moves it on the card and saves the place, as fractions,
 * without opening the editor. A press without movement still opens it
 * (HON-975).
 */
export const DragNote: Story = {
  name: 'Drag the note (desktop)',
  args: tallNotedCard,
  parameters: { cardWidth: 'desktop', msw: { handlers: notePatchHandlers() } },
  play: async ({ canvasElement }) => {
    notePatches = []
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: LONG_NAME })
    await document.fonts.ready
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const slip = canvas.getByRole('button', { name: NOTE })
    await expect(slip).toHaveClass('touch-none')
    const before = slipInCard(card)

    await dragSlip(slip, -60, -20)

    const after = slipInCard(card)
    await expect(after.left - before.left).toBeCloseTo(-60, 0)
    await expect(after.top - before.top).toBeCloseTo(-20, 0)
    await expect(noteOverlay(card)).toHaveAttribute('data-placed')
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
    // A drag is not a card click (HON-1010).
    await expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(notePositionPatches()).toHaveLength(1))
    const saved = notePositionPatches()[0] as { noteX: number; noteY: number }
    for (const value of [saved.noteX, saved.noteY]) {
      await expect(value).toBeGreaterThanOrEqual(0)
      await expect(value).toBeLessThanOrEqual(1)
    }
    await expect(Object.keys(notePositionPatches()[0] ?? {}).sort()).toEqual(['noteX', 'noteY'])

    // A click without movement opens the editor, as before.
    await userEvent.click(slip)
    await expect(await canvas.findByRole('textbox', { name: /note/i })).toBeVisible()
  },
}

/**
 * The slip cannot leave the card, nor cover its first row: dragged far up
 * and left it stops below the slot badge and the ⋯ menu, inside the card
 * (HON-975).
 */
export const DragNoteIsClamped: Story = {
  name: 'Drag the note past the card (desktop)',
  args: tallNotedCard,
  parameters: { cardWidth: 'desktop', msw: { handlers: notePatchHandlers() } },
  play: async ({ canvasElement }) => {
    notePatches = []
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: LONG_NAME })
    await document.fonts.ready
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const slip = canvas.getByRole('button', { name: NOTE })

    await dragSlip(slip, -2000, -2000)

    const slipBox = slip.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    await expect(slipBox.left).toBeGreaterThanOrEqual(cardBox.left)
    await expect(slipBox.top).toBeGreaterThanOrEqual(cardBox.top)
    const menu = canvas.getByRole('button', { name: /^more actions/i }).getBoundingClientRect()
    const slotBadge = card
      .querySelector<HTMLElement>('[data-slot="badge"]')!
      .getBoundingClientRect()
    await expect(overlaps(slipBox, menu)).toBe(false)
    await expect(overlaps(slipBox, slotBadge)).toBe(false)
    await waitFor(() => expect(notePositionPatches()).toHaveLength(1))
  },
}

/**
 * The arrow keys move a focused slip 8px, and the place is saved once the
 * keys are still. Enter still opens the editor (HON-975).
 */
export const KeyboardMoveNote: Story = {
  name: 'Move the note with the keyboard (desktop)',
  args: tallNotedCard,
  parameters: { cardWidth: 'desktop', msw: { handlers: notePatchHandlers() } },
  play: async ({ canvasElement }) => {
    notePatches = []
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: LONG_NAME })
    await document.fonts.ready
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const slip = canvas.getByRole('button', { name: NOTE })
    await expect(slip).toHaveAccessibleDescription(/arrow keys/i)
    slip.focus()
    const before = slipInCard(card)

    await userEvent.keyboard('{ArrowLeft}')

    const after = slipInCard(card)
    await expect(after.left - before.left).toBeCloseTo(-8, 0)
    await expect(after.top).toBeCloseTo(before.top, 0)
    await expect(notePositionPatches()).toHaveLength(0)
    await waitFor(() => expect(notePositionPatches()).toHaveLength(1))
    await expect(slip).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await expect(await canvas.findByRole('textbox', { name: /note/i })).toBeVisible()
  },
}

/** A failed save puts the slip back where the server has it (HON-975). */
export const DragNoteFailedSave: Story = {
  name: 'Drag the note, save fails (desktop)',
  args: tallNotedCard,
  parameters: { cardWidth: 'desktop', msw: { handlers: notePatchHandlers(500) } },
  play: async ({ canvasElement }) => {
    notePatches = []
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: LONG_NAME })
    await document.fonts.ready
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const slip = canvas.getByRole('button', { name: NOTE })
    const before = slipInCard(card)

    await dragSlip(slip, -60, -20)

    await waitFor(() => expect(notePositionPatches()).toHaveLength(1))
    await waitFor(() => expect(noteOverlay(card)).not.toHaveAttribute('data-placed'))
    const after = slipInCard(card)
    await expect(after.left).toBeCloseTo(before.left, 0)
    await expect(after.top).toBeCloseTo(before.top, 0)
  },
}

/** A slip the household dragged lies at its saved place on the next load (HON-975). */
export const SavedNotePosition: Story = {
  name: 'Saved note position (phone)',
  args: { ...tallNotedCard, noteX: 0.05, noteY: 0.55 },
  parameters: { cardWidth: 'phone' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: LONG_NAME })
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const head = card.querySelector<HTMLElement>('[data-slot="meal-image-head"]')!
    const overlay = noteOverlay(card)
    await expect(overlay).toHaveAttribute('data-placed')
    // The fractions are of the room the slip has to move in.
    const headBox = head.getBoundingClientRect()
    const overlayBox = overlay.getBoundingClientRect()
    await expect(overlayBox.left - headBox.left).toBeCloseTo(
      (headBox.width - overlayBox.width) * 0.05,
      0,
    )
    await expect(overlayBox.top - headBox.top).toBeCloseTo(
      (headBox.height - overlayBox.height) * 0.55,
      0,
    )
  },
}

/**
 * A place saved against more room than this card has: flush with the top
 * right corner, over the ⋯ menu. It is fitted to the card as it is, for
 * display, so the menu stays reachable and the slip stays on the card
 * (HON-975).
 */
export const SavedPlaceKeepsMenuClear: Story = {
  name: 'Saved place over the menu (phone)',
  args: { ...PlannedWithImageAndNote.args, noteX: 1, noteY: 0 },
  parameters: { cardWidth: 'phone' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('img', { name: mealFixture.name })
    await document.fonts.ready
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    const slip = canvas.getByRole('button', { name: NOTE })
    const menu = canvas.getByRole('button', { name: /^more actions/i })
    await waitFor(() =>
      expect(overlaps(slip.getBoundingClientRect(), menu.getBoundingClientRect())).toBe(false),
    )
    const slipBox = slip.getBoundingClientRect()
    const cardBox = card.getBoundingClientRect()
    await expect(slipBox.top).toBeGreaterThanOrEqual(cardBox.top)
    await expect(slipBox.bottom).toBeLessThanOrEqual(cardBox.bottom)
    await expect(slipBox.right).toBeLessThanOrEqual(cardBox.right)
  },
}

const PAST_NOTE = 'Swapped the rice for couscous — do that again.'

/**
 * Asserts the image runs from the card's top edge (inside its border) past the
 * bottom of the head to the first row below it, and returns its box (HON-927).
 */
async function assertImageBoundedByHead(card: HTMLElement) {
  const box = within(card).getByTestId('meal-card-image').getBoundingClientRect()
  const head = card.querySelector('[data-slot="meal-image-head"]')!
  const firstRow = head.nextElementSibling!.getBoundingClientRect()
  await expect(box.top).toBeCloseTo(card.getBoundingClientRect().top + card.clientTop, 0)
  await expect(box.bottom).toBeGreaterThanOrEqual(head.getBoundingClientRect().bottom)
  await expect(box.bottom).toBeCloseTo(firstRow.top, 0)
  return box
}

/**
 * A past day with everything below the title: the status control and the
 * rating prompt (opened from the rating badge) are rows below the head, and
 * the image runs the head's height (HON-927), so neither sits on the dish
 * (HON-755). The note is not a row: its slip lies over the head's bottom-right
 * corner, on the plate and off the rows below (HON-974).
 */
async function assertLowerRowsOnTint(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await canvas.findByRole('img', { name: mealFixture.name })
  await userEvent.click(canvas.getByRole('button', { name: /^rating:/i }))
  await document.fonts.ready
  const rows = [
    canvas.getByRole('combobox', { name: /meal status/i }),
    await canvas.findByText('How was it?'),
    canvas.getByRole('button', { name: /^thumbs up$/i }),
    canvas.getByRole('button', { name: /^thumbs down$/i }),
  ]
  const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
  const box = await assertImageBoundedByHead(card)
  for (const row of rows) {
    await expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom)
  }
  const slip = canvas.getByText(PAST_NOTE).closest<HTMLElement>('[data-surface="sticky"]')!
  const slipBox = slip.getBoundingClientRect()
  await expect(slipBox.top).toBeGreaterThanOrEqual(card.getBoundingClientRect().top)
  await expect(slipBox.bottom).toBeLessThanOrEqual(box.bottom)
  // The title still clears the opaque part, as in `PlannedWithImage`, and the
  // slip clears the title.
  const title = canvas.getByRole('button', { name: mealFixture.name }).getBoundingClientRect()
  await expect(title.right).toBeLessThanOrEqual(box.left + box.width * 0.3)
  await expect(overlaps(slipBox, title)).toBe(false)
}

export const PastWithImagePhone: Story = {
  name: 'Past with image, note and rating (phone)',
  args: {
    meal: { ...mealFixture, imageStatus: 'ready', imageUrl: mealIllustration.src, imageHue: 52 },
    status: 'completed',
    rating: 'up',
    isPast: true,
    note: PAST_NOTE,
  },
  parameters: { cardWidth: 'phone' },
  play: async ({ canvasElement }) => assertLowerRowsOnTint(canvasElement),
}

export const PastWithImageDesktop: Story = {
  ...PastWithImagePhone,
  name: 'Past with image, note and rating (desktop)',
  parameters: { cardWidth: 'desktop' },
}

export const PlannedWithImageDark: Story = {
  ...PlannedWithImage,
  name: 'Planned with image (dark)',
  globals: { theme: 'dark' },
  play: undefined,
}

export const Planned: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Every control on the card clears the 32px `sm` floor (HON-688) — the
    // meal name included, which is a wrapping text button rather than a
    // `Button` and so takes its height from `min-h-8`, not a size variant.
    for (const button of canvas.getAllByRole('button')) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
    }

    // The slot label is the card's first row (docs/DESIGN.md → Composition),
    // above the meal name.
    const badge = canvas.getByText('Dinner').getBoundingClientRect()
    const name = canvas.getByRole('button', { name: mealFixture.name }).getBoundingClientRect()
    await expect(badge.bottom).toBeLessThanOrEqual(name.top)

    // The counterpart to `CompletedThumbsUp` below: Swap is offered here, so
    // its absence there cannot pass on a card that failed to render at all.
    await openMoreActions(canvasElement)
    await expect(
      await within(document.body).findByRole('menuitem', { name: /^swap$/i }),
    ).toBeInTheDocument()
  },
}

/**
 * Note opens the editor with its textarea focused, typing lands in it, and
 * Escape cancels with focus back on ⋯ (HON-946). `pick` chooses Note with
 * the pointer or the keyboard: with the pointer, Radix moved focus back into
 * the closing menu after the editor had taken it, and it fell to the body
 * once the menu unmounted.
 */
async function assertNoteFromMenu(
  canvasElement: HTMLElement,
  pick: (body: ReturnType<typeof within>) => Promise<void>,
) {
  const canvas = within(canvasElement)
  const body = within(document.body)
  const trigger = canvas.getByRole('button', { name: /more actions/i })

  await pick(body)
  const textarea = await canvas.findByRole('textbox', { name: /note/i })
  // Past the menu's 200ms exit: its close is the last thing to move focus.
  await waitFor(() => expect(body.queryByRole('menu')).not.toBeInTheDocument())
  await new Promise((resolve) => setTimeout(resolve, 50))
  await expect(document.activeElement).toBe(textarea)

  await userEvent.keyboard('Leftovers')
  await expect(textarea).toHaveValue('Leftovers')

  await pressEscape()
  await waitFor(() => expect(canvas.queryByRole('textbox')).not.toBeInTheDocument())
  await expect(document.activeElement).toBe(trigger)
}

/** Note lives in the more-actions menu, not on the card. */
export const NoteFromMenu: Story = {
  name: 'Note from the menu (pointer)',
  args: { meal: mealFixture, status: 'planned' },
  play: async ({ canvasElement }) =>
    assertNoteFromMenu(canvasElement, async (body) => {
      await expect(
        within(canvasElement).queryByRole('button', { name: /^note$/i }),
      ).not.toBeInTheDocument()
      await openMoreActions(canvasElement)
      await userEvent.click(await body.findByRole('menuitem', { name: /^note$/i }))
    }),
}

export const NoteFromMenuKeyboard: Story = {
  name: 'Note from the menu (keyboard)',
  args: { meal: mealFixture, status: 'planned' },
  play: async ({ canvasElement }) =>
    assertNoteFromMenu(canvasElement, async (body) => {
      within(canvasElement)
        .getByRole('button', { name: /more actions/i })
        .focus()
      await userEvent.keyboard('{Enter}')
      // Radix focuses the first item when the menu opens from the keyboard.
      await waitFor(() =>
        expect(document.activeElement).toBe(body.getByRole('menuitem', { name: /^note$/i })),
      )
      await userEvent.keyboard('{Enter}')
    }),
}

export const PlannedAlreadyCharged: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    pantryDeducted: true,
    // The status control only renders on past days.
    isPast: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Completed once, then reverted to planned. The pantry was already charged and the server never charges an entry twice (HON-651), so completing again skips the deduction preview.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('combobox', { name: /meal status/i }))
    await userEvent.click(await body.findByRole('option', { name: /completed/i }))

    // The status did change — so the missing dialog below is not a click that
    // never landed.
    await waitFor(() =>
      expect(canvas.getByRole('combobox', { name: /meal status/i })).toHaveTextContent(
        /completed/i,
      ),
    )
    await expect(body.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/**
 * "Done cooking" in the cook view runs the same completion as the status
 * select (HON-933): the view closes first, then the pantry deduction opens —
 * never stacked on it — and confirming shows the rating prompt, with focus
 * back on the meal's name rather than the page body.
 */
export const DoneCookingFromCookView: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
  },
  parameters: {
    msw: {
      handlers: {
        // Opening a planned meal generates its steps on open.
        tips: [
          http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () =>
            HttpResponse.json({
              tips: {
                equipment: ['A roasting tin'],
                steps: ['Preheat while you prep', 'Roast for 35 minutes'],
                pitfalls: [],
              },
            }),
          ),
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)
    const name = canvas.getByRole('button', { name: mealFixture.name })

    await userEvent.click(name)
    const cookView = await body.findByRole('dialog', { name: mealFixture.name })
    await userEvent.click(
      await within(cookView).findByRole('button', { name: 'Done cooking' }, ROUND_TRIP),
    )

    const deduction = await body.findByRole('dialog', { name: 'Mark as completed' })
    // One dialog at a time: the cook view is gone before the deduction opens.
    await expect(body.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.click(within(deduction).getByRole('button', { name: 'Confirm' }))
    await awaitDialogClosed(ROUND_TRIP.timeout)

    await expect(await canvas.findByText('How was it?')).toBeInTheDocument()
    await waitFor(() => expect(name).toHaveFocus())

    // Today's card has no status select, so the menu carries the way back.
    await openMoreActions(canvasElement)
    await userEvent.click(await body.findByRole('menuitem', { name: 'Not cooked yet' }))
    await waitFor(() => expect(canvas.queryByText('How was it?')).not.toBeInTheDocument())
  },
}

// For waits that sit behind an MSW response. The swap stories chain several
// dialogs and round-trips, and on a loaded CI runner a render can land after
// `findBy`'s default 1 s even though the request succeeded (HON-857).
const ROUND_TRIP = { timeout: 3000 }

// Counts the POSTs the story's handlers serve, so a second one can be proven to
// be a real re-fetch rather than a replay of cached state.
let swapTipsRequests = 0
let swapSuggestionRequests = 0

/**
 * Stands in for `regenerate/route.ts`, which excludes whichever meal the entry
 * holds when the list is built. Call 1 runs against the chicken and offers the
 * stir-fry; call 2 runs against the stir-fry just picked and offers the risotto
 * instead — so a replayed call-1 list is visible as the stir-fry being proposed
 * as an alternative to itself.
 */
function swapAlternatives(call: number): AlternativeMeal[] {
  const meal = (id: string, name: string): AlternativeMeal => ({
    id,
    name,
    description: `${name} — a weeknight alternative.`,
    timeMinutes: 30,
    kidFriendly: true,
    primaryProteinType: 'none',
    suitableFor: [MealType.dinner],
    components: lemonGarlicChickenComponents,
    nutrition: { calories: 480, protein: 30, carbs: 40, fat: 18 },
  })
  return call === 1
    ? [meal('meal-stir-fry', 'Beef stir-fry')]
    : [meal('meal-risotto', 'Mushroom risotto')]
}

/**
 * A swap repoints the entry server-side, and the same PATCH nulls the entry's
 * cached `preparationTips` and resets its `servingOverride`. Neither reset
 * reaches the client on its own. The detail modal is rendered unconditionally
 * by this card
 * — `open` is a prop, not a mount guard — so its `useMealTips` instance never
 * unmounts, and `entryId` does not change on a swap either; the serving count
 * is this card's own `useState`. Without the reset in `onSwapComplete`,
 * reopening the modal replays the previous meal's tips under the new meal's
 * name and never re-POSTs, and the card keeps the old override (HON-682).
 *
 * The card still shows the old meal name after the swap here: the real reset
 * comes from `router.refresh()`, which is a no-op under the Storybook app-router
 * mock. That is fine — what this story pins is the client state the refresh
 * cannot reach.
 */
export const SwapDropsCachedTips: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    // The swap resets this to null server-side, so the badge must go with it.
    servingOverride: 6,
  },
  parameters: {
    // An array replaces `defaultHandlers` wholesale, which is what this story
    // needs: it has to count the suggestions POST, and a keyed override would
    // merely be appended after the default handler that already matches it.
    // So the entry PATCH has to be re-declared alongside — without it the swap
    // fails and nothing downstream is asserted.
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
        // The real route filters out whichever meal the entry currently holds,
        // so the list is only correct for the meal it was built against.
        http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', () => {
          swapSuggestionRequests += 1
          return HttpResponse.json({ alternatives: swapAlternatives(swapSuggestionRequests) })
        }),
        // Varies per call, so the second click can be told apart from a
        // replay of the first one's object.
        http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () => {
          swapTipsRequests += 1
          return HttpResponse.json({
            tips: {
              equipment: [
                swapTipsRequests === 1
                  ? 'A roasting tin for the chicken'
                  : 'A wok for the stir-fry',
              ],
              steps: ['Preheat while you prep'],
              pitfalls: ['Crowding the pan steams instead of browning'],
            },
          })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    swapTipsRequests = 0
    swapSuggestionRequests = 0
    const canvas = within(canvasElement)
    const body = within(document.body)

    // Opening the planned meal generates its tips (HON-933).
    await expect(canvas.getByText('6 servings')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: mealFixture.name }))
    await body.findByText(/roasting tin/i, undefined, ROUND_TRIP)

    // Close the detail modal — the Swap control lives on the card behind it.
    await userEvent.keyboard('{Escape}')
    await awaitDialogClosed()

    // Swap the entry to a different meal.
    await openMoreActions(canvasElement)
    await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
    const selector = await body.findByRole('dialog')
    await within(selector).findByText('Beef stir-fry', undefined, ROUND_TRIP)
    await userEvent.click(within(selector).getByRole('button', { name: /^select$/i }))
    // Select closes the dialog only once its PATCH resolves.
    await awaitDialogClosed(ROUND_TRIP.timeout)

    // The card is back to the household's own size, matching the
    // `servingOverride: null` the server wrote.
    await waitFor(() => expect(canvas.queryByText('6 servings')).not.toBeInTheDocument())

    // Reopen the modal. The serving control agrees with the card...
    await userEvent.click(canvas.getByRole('button', { name: mealFixture.name }))
    const reopened = await body.findByRole('dialog')
    await expect(within(reopened).getByRole('button', { name: /serves 4/i })).toBeInTheDocument()

    // ...and the view generates the new meal's tips with a real second POST
    // rather than replaying the previous meal's. This is the assertion that
    // pins `cancelTips()`: with the stale object still in the hook, the view
    // would show it and never ask, since it generates only when it has none.
    await body.findByText(/wok for the stir-fry/i, undefined, ROUND_TRIP)
    await expect(body.queryByText(/roasting tin/i)).not.toBeInTheDocument()
    await expect(swapTipsRequests).toBe(2)

    // The suggestions list is stale for the same reason and at the same
    // callsite: its query key carries no meal id, it is held at
    // `staleTime: Infinity`, and the selector never unmounts either. Replayed,
    // it would offer the meal just picked as an alternative to itself, and
    // picking it would re-PATCH the entry to the meal it already holds.
    await userEvent.keyboard('{Escape}')
    await awaitDialogClosed()
    await openMoreActions(canvasElement)
    await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
    const reopenedSelector = await body.findByRole('dialog')
    await within(reopenedSelector).findByText('Mushroom risotto', undefined, ROUND_TRIP)
    await expect(within(reopenedSelector).queryByText('Beef stir-fry')).not.toBeInTheDocument()
    await expect(swapSuggestionRequests).toBe(2)
  },
}

// Per-entry suggestion POST counts, so the second card's list can be shown to
// refetch after the first card swaps.
const planSuggestionRequests: Record<string, number> = {}

// POSTs served while re-selecting the meal already on the entry.
let reselectTipsRequests = 0

/**
 * Selecting a meal is not necessarily a *swap*. `/regenerate` filters the
 * planned meal out of its suggestions, but search and "my recipes" browse go
 * to `/api/meals` unfiltered (`meal-selector/use-meal-alternatives.ts`), so the
 * dish already on the entry is listed there and can be clicked —
 * `MealSelectorModal.handleSelect` PATCHes whatever row was selected.
 *
 * That write changes nothing, and the server treats it as nothing: the three
 * resets in the swap branch are gated on `parsed.data.mealId !== entry.mealId`,
 * so `servingOverride`, `preparationTips` and `rating` all survive (HON-703).
 * The card has to draw the same line — it resets its own copies in
 * `onSwapComplete`, and `router.refresh()` cannot reseed a `useState`, so an
 * unconditional reset would leave the card showing 4 servings against a row
 * that says 6 for the rest of the session.
 *
 * The counterpart to `SwapDropsCachedTips` above: same controls, same
 * assertions, opposite expectations — which is what makes either story
 * meaningful.
 */
export const ReselectingThePlannedMealResetsNothing: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    // Household is 4, so this renders a "6 servings" badge — and the badge is
    // the assertion, since a reset would drop it back to the household size.
    servingOverride: 6,
  },
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
        // Search does not exclude the planned meal, so it comes back with the
        // very id the entry already holds — the whole point of the story.
        http.get('/api/meals', () =>
          HttpResponse.json({
            meals: [
              {
                id: mealFixture.id,
                name: mealFixture.name,
                description: 'The dish already on this entry.',
                timeMinutes: 45,
                kidFriendly: true,
                primaryProteinType: 'poultry',
                suitableFor: [MealType.dinner],
                components: lemonGarlicChickenComponents,
                nutrition: { calories: 520, protein: 42, carbs: 30, fat: 28 },
              },
            ],
            hasMore: false,
            total: 1,
          }),
        ),
        http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', () =>
          HttpResponse.json({ alternatives: swapAlternatives(1) }),
        ),
        http.post('/api/meal-plans/:planId/entries/:entryId/preparation-tips', () => {
          reselectTipsRequests += 1
          return HttpResponse.json({
            tips: {
              equipment: ['A roasting tin for the chicken'],
              steps: ['Preheat while you prep'],
              pitfalls: ['Crowding the pan steams instead of browning'],
            },
          })
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    reselectTipsRequests = 0
    const canvas = within(canvasElement)
    const body = within(document.body)

    // Opening the planned meal generates its tips, so there is something to lose.
    await expect(canvas.getByText('6 servings')).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: mealFixture.name }))
    await body.findByText(/roasting tin/i, undefined, ROUND_TRIP)
    await expect(reselectTipsRequests).toBe(1)

    await userEvent.keyboard('{Escape}')
    await awaitDialogClosed()

    // Search for the meal already planned and select it again.
    await openMoreActions(canvasElement)
    await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
    const selector = await body.findByRole('dialog')
    await userEvent.type(within(selector).getByRole('searchbox'), 'lemon')
    // The search list offers the planned dish back — `/regenerate` would not.
    const result = await within(selector).findByText(mealFixture.name, undefined, ROUND_TRIP)
    await expect(result).toBeInTheDocument()
    await userEvent.click(within(selector).getByRole('button', { name: /^select$/i }))
    // Select closes the dialog only once its PATCH resolves.
    await awaitDialogClosed(ROUND_TRIP.timeout)

    // The override the household set is still on the card, matching the row
    // the server did not touch.
    await expect(canvas.getByText('6 servings')).toBeInTheDocument()

    // And the tips were not discarded: reopening shows them still expanded,
    // and no second POST was issued. `SwapDropsCachedTips` asserts the exact
    // opposite pair for a real swap.
    await userEvent.click(canvas.getByRole('button', { name: mealFixture.name }))
    const reopened = await body.findByRole('dialog')
    await expect(within(reopened).getByText(/roasting tin/i)).toBeInTheDocument()
    await expect(reselectTipsRequests).toBe(1)
  },
}

/**
 * The suggestions cache has to be dropped for the whole plan, not just the
 * entry that was swapped. Both suggestion routes filter candidates through
 * `recentMealIds` — every meal the household planned within `NO_REPEAT_DAYS`,
 * excluded by `candidates.ts:128` — so planning a meal on Monday removes it
 * from Tuesday's candidate set too. Every card shares one `QueryClient` and the
 * key is held at `staleTime: Infinity`, so a per-entry removal would leave
 * Tuesday still offering the meal just planned for Monday, and picking it would
 * plan the same dinner twice in one week (review round 2 on PR #785).
 */
export const SwapDropsSuggestionsForSiblingEntries: Story = {
  args: { meal: mealFixture, status: 'planned' },
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/meal-plans/:planId/entries/:entryId', () =>
          HttpResponse.json({ ok: true }),
        ),
        http.post('/api/meal-plans/:planId/entries/:entryId/regenerate', ({ params }) => {
          const entryId = String(params.entryId)
          const call = (planSuggestionRequests[entryId] ?? 0) + 1
          planSuggestionRequests[entryId] = call
          return HttpResponse.json({ alternatives: swapAlternatives(call) })
        }),
      ],
    },
  },
  // Two cards on one plan, sharing the page's QueryClient exactly as the
  // timeline renders them.
  render: (args) => (
    <div className="flex flex-col gap-4">
      <div data-testid="monday">
        <MealCard {...args} entryId="entry-monday" />
      </div>
      <div data-testid="tuesday">
        <MealCard {...args} entryId="entry-tuesday" />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    planSuggestionRequests['entry-monday'] = 0
    planSuggestionRequests['entry-tuesday'] = 0
    const canvas = within(canvasElement)
    const body = within(document.body)

    const monday = within(canvas.getByTestId('monday'))
    const tuesday = within(canvas.getByTestId('tuesday'))

    const openSwap = async (card: ReturnType<typeof within>) => {
      await userEvent.click(card.getByRole('button', { name: /more actions/i }))
      await userEvent.click(await body.findByRole('menuitem', { name: /^swap$/i }))
      return body.findByRole('dialog')
    }
    const closeSwap = async () => {
      await userEvent.keyboard('{Escape}')
      await awaitDialogClosed()
    }

    // Tuesday caches a list that still offers the stir-fry.
    const tuesdayFirst = await openSwap(tuesday)
    await within(tuesdayFirst).findByText('Beef stir-fry', undefined, ROUND_TRIP)
    await closeSwap()

    // Monday takes the stir-fry.
    const mondaySwap = await openSwap(monday)
    await within(mondaySwap).findByText('Beef stir-fry', undefined, ROUND_TRIP)
    await userEvent.click(within(mondaySwap).getByRole('button', { name: /^select$/i }))
    // Select closes the dialog only once its PATCH resolves.
    await awaitDialogClosed(ROUND_TRIP.timeout)

    // Tuesday must refetch rather than replay — the stir-fry is Monday's
    // dinner now, and offering it here would plan it twice in one week.
    const tuesdaySecond = await openSwap(tuesday)
    await within(tuesdaySecond).findByText('Mushroom risotto', undefined, ROUND_TRIP)
    await expect(within(tuesdaySecond).queryByText('Beef stir-fry')).not.toBeInTheDocument()
    await expect(planSuggestionRequests['entry-tuesday']).toBe(2)
  },
}

/**
 * The note is a taped sticky-note slip, and the slip is the button that opens
 * the editor (HON-926). With no image, the card still lies the slip over its
 * corner, and caps the title so the name wraps before the slip (HON-974).
 */
export const PlannedWithNote: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    note: NOTE,
  },
  parameters: { cardWidth: 'phone' },
  play: async ({ canvasElement }) => {
    const slip = within(canvasElement).getByRole('button', { name: NOTE })
    await expect(slip).toHaveAttribute('data-surface', 'sticky')
    await expect(slip).toHaveAttribute('data-variant', 'interactive')
    const card = canvasElement.querySelector<HTMLElement>('[data-slot="card"]')!
    await assertSlipOverCard(card, slip)
  },
}

export const WithServingOverride: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    servingOverride: 6,
  },
}

export const LowAvailability: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    // The olive oil is what gives the pantry data: a staples-only pantry shows
    // no badge (see `StaplesOnlyPantry`).
    pantryIngredients: [
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'olive-oil', isStaple: false },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Most ingredients not in the pantry — shows the amber "to buy" availability indicator.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3 ingredients to buy')).toBeInTheDocument()
  },
}

export const StaplesOnlyPantry: Story = {
  args: {
    meal: mealFixture,
    status: 'planned',
    pantryIngredients: [
      { ingredientId: 'garlic', isStaple: true },
      { ingredientId: 'salt', isStaple: true },
    ],
  },
  parameters: {
    docs: {
      description: {
        story:
          'Every household starts with salt, black pepper and water as staples (HON-769). A pantry holding only staples says nothing yet, so the card shows no availability badge, as the meal picker does (HON-824).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: mealFixture.name })).toBeInTheDocument()
    await expect(canvas.queryByText(/ingredients? to buy|have all ingredients/i)).toBeNull()
  },
}

export const CompletedThumbsUp: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
  },
  parameters: {
    docs: {
      description: {
        story:
          'No Swap control: a completed entry records what was cooked and what the pantry was charged for, and the API refuses to repoint it (409, HON-633). Note and Clear stay available.',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    await openMoreActions(canvasElement)
    // Note and Clear are in the same menu, so the missing Swap is not a menu
    // that never opened.
    await expect(await body.findByRole('menuitem', { name: /^note$/i })).toBeInTheDocument()
    await expect(body.getByRole('menuitem', { name: /^clear$/i })).toBeInTheDocument()
    await expect(body.queryByRole('menuitem', { name: /^swap$/i })).not.toBeInTheDocument()
  },
}

export const CompletedThumbsDown: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'down',
  },
}

export const CompletedUnrated: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: null,
  },
}

export const Skipped: Story = {
  args: {
    meal: mealFixture,
    status: 'skipped',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Swap is still offered: nothing was deducted for a skipped meal, so “actually, let’s cook something” stays a legitimate path (HON-633).',
      },
    },
  },
  play: async ({ canvasElement }) => {
    await openMoreActions(canvasElement)
    await expect(
      await within(document.body).findByRole('menuitem', { name: /^swap$/i }),
    ).toBeInTheDocument()
  },
}

export const PastCompleted: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
    isPast: true,
  },
}

export const PastReadonly: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
    isPast: true,
    isReadOnly: true,
  },
}

/** A past card's note is the same slip, read-only: tilted, not a button. */
export const PastWithNote: Story = {
  args: {
    meal: mealFixture,
    status: 'completed',
    rating: 'up',
    isPast: true,
    note: PAST_NOTE,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const slip = canvas.getByText(PAST_NOTE).closest('[data-surface="sticky"]')
    await expect(slip).toHaveAttribute('data-variant', 'static')
    await expect(canvas.queryByRole('button', { name: PAST_NOTE })).toBeNull()
  },
}

export const PastWithNoteDark: Story = {
  ...PastWithNote,
  name: 'Past with note (dark)',
  globals: { theme: 'dark' },
}

export const EmptyPlanned: Story = {
  args: {
    meal: null,
    status: 'planned',
  },
}

/** The empty slot's note renders once, as the editor's slip (HON-926: it used to show twice). */
export const EmptyWithNote: Story = {
  args: {
    meal: null,
    status: 'planned',
    note: 'Maybe leftovers tonight.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('Maybe leftovers tonight.')).toHaveLength(1)
    await expect(canvas.getByRole('button', { name: 'Maybe leftovers tonight.' })).toHaveAttribute(
      'data-surface',
      'sticky',
    )
  },
}

/** A read-only empty slot shows its note as a plain slip, once, with nothing to click. */
export const EmptyReadonlyWithNote: Story = {
  args: {
    meal: null,
    status: 'planned',
    isReadOnly: true,
    note: 'Maybe leftovers tonight.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [note, ...rest] = canvas.getAllByText('Maybe leftovers tonight.')
    await expect(rest).toHaveLength(0)
    const slip = note!.closest('[data-surface="sticky"]')
    await expect(slip).toHaveAttribute('data-variant', 'static')
    await expect(canvas.queryByRole('button', { name: 'Maybe leftovers tonight.' })).toBeNull()
  },
}

export const EmptyReadonly: Story = {
  args: {
    meal: null,
    status: 'planned',
    isReadOnly: true,
  },
}
