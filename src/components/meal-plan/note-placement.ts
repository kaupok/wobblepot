/**
 * Where a note's slip lies on the planner card (HON-975, docs/DESIGN.md →
 * "Notes are sticky notes"). Pure, so the server render and the client agree.
 */

/** A slip's own small offset and tilt from its default corner. */
export interface NoteScatter {
  /** Horizontal offset in px. Leftward only: the ⋯ column is the right edge. */
  x: number
  /** Vertical offset in px. Upward only: the card's 8px padding is the bottom edge. */
  y: number
  /** Tilt at rest, in degrees. Hover and focus straighten it. */
  tilt: number
}

/**
 * A slip the household placed, as fractions (0–1) of the room it has to move
 * in on the card head: 0 is flush with the head's left or top edge, 1 with its
 * right or bottom edge. Fractions, so a place set on a desktop lands in the
 * same spot on a phone; of the room rather than the head, so the slip stays on
 * a card where it wraps taller or the card is shorter.
 */
export interface NotePosition {
  x: number
  y: number
}

/** How a `MealImageCard` overlay lies: its own scatter, and a saved place if there is one. */
export interface NotePlacement {
  scatter: NoteScatter
  position: NotePosition | null
}

/**
 * The scatter ranges. Inside the issue's ±12px and ±3°, and one-sided where
 * the default corner is already at its limit: right is the ⋯ column's edge,
 * down is the card's padding, and a 3° tilt pokes a corner out about 4px. Left
 * past 8px reaches the widest pantry badge (Estonian, on a phone). Change
 * these with `OVERLAY_ANCHOR` in `MealImageCard.tsx`.
 */
export const NOTE_SCATTER_RANGE = {
  x: { min: -8, max: 0 },
  y: { min: -8, max: 0 },
  /** Absolute tilt: every slip leans at least this far one way or the other. */
  tilt: { min: 1, max: 3 },
} as const

/** FNV-1a, 32-bit: a stable seed from the entry id. */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: three independent draws from one seed, where an id's bits alone would correlate. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The slip's scatter, derived from the entry id rather than `Math.random()`:
 * the card renders on the server and hydrates on the client, and the same
 * entry must lie the same way on every load.
 */
export function noteScatter(entryId: string): NoteScatter {
  const random = seededRandom(hashString(entryId))
  const { x, y, tilt } = NOTE_SCATTER_RANGE
  // `|| 0` turns a rounded -0 into 0, which reads `0px` rather than `-0px`.
  const offset = (range: { min: number; max: number }) =>
    Math.round(range.min + random() * (range.max - range.min)) || 0
  const scatterX = offset(x)
  const scatterY = offset(y)
  const sign = random() < 0.5 ? -1 : 1
  // Quarter-degree steps.
  const magnitude = Math.round((tilt.min + random() * (tilt.max - tilt.min)) * 4) / 4
  return { x: scatterX, y: scatterY, tilt: sign * magnitude }
}

/** The card head's geometry a clamp needs, in px relative to the head's top-left. */
export interface NoteBounds {
  width: number
  height: number
  /** Bottom edge of the card's first row (the slot badge and the ⋯ menu). */
  firstRowBottom: number
  /** Left edge of the ⋯ menu, or null on a card without one. */
  menuLeft: number | null
}

/** Clear space the slip keeps from the head's sides, from the first row and from the ⋯ menu. */
export const NOTE_EDGE_INSET = 4

/**
 * How far a slip's tilted corners stick out past its untransformed box, on
 * each side. The slip turns about its centre.
 */
function tiltOverhang(slip: { width: number; height: number; tilt: number }) {
  const angle = (Math.abs(slip.tilt) * Math.PI) / 180
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  return {
    x: (slip.width * cos + slip.height * sin - slip.width) / 2,
    y: (slip.width * sin + slip.height * cos - slip.height) / 2,
  }
}

/**
 * Keeps a slip at `left`/`top` (px, its untransformed top-left) inside the
 * card head and below its first row, so the ⋯ menu stays reachable. The
 * bounds hold for the tilted slip, corners and all.
 *
 * On a card too short for the slip to fit below the first row, it lies at the
 * bottom instead, beside that row as at its default place, and its right edge
 * stays left of the menu.
 */
export function clampNotePosition(
  left: number,
  top: number,
  slip: { width: number; height: number; tilt: number },
  bounds: NoteBounds,
): { left: number; top: number } {
  const overhang = tiltOverhang(slip)
  const maxTop = Math.max(0, bounds.height - slip.height - overhang.y)
  const belowFirstRow = bounds.firstRowBottom + NOTE_EDGE_INSET + overhang.y
  const minTop = Math.min(belowFirstRow, maxTop)
  const clampedTop = Math.min(Math.max(top, minTop), maxTop)

  const besideFirstRow = clampedTop < belowFirstRow
  const rightEdge =
    besideFirstRow && bounds.menuLeft !== null
      ? bounds.menuLeft - NOTE_EDGE_INSET
      : bounds.width - NOTE_EDGE_INSET
  const minLeft = NOTE_EDGE_INSET + overhang.x
  const maxLeft = Math.max(minLeft, rightEdge - overhang.x - slip.width)
  const clampedLeft = Math.min(Math.max(left, minLeft), maxLeft)

  return { left: clampedLeft, top: clampedTop }
}

/**
 * A slip's top-left in the head (px) → the stored fractions of its room,
 * rounded so the payload stays short. `MealImageCard` reverses it in CSS:
 * `left: x%` of the head less `x%` of the slip's own width.
 */
export function toNotePosition(
  left: number,
  top: number,
  slip: { width: number; height: number },
  bounds: Pick<NoteBounds, 'width' | 'height'>,
): NotePosition {
  const fraction = (value: number, room: number) =>
    room > 0 ? Math.min(1, Math.max(0, Math.round((value / room) * 10000) / 10000)) : 0
  return {
    x: fraction(left, bounds.width - slip.width),
    y: fraction(top, bounds.height - slip.height),
  }
}
