import { describe, it, expect } from 'vitest'
import {
  NOTE_EDGE_INSET,
  NOTE_SCATTER_RANGE,
  clampNotePosition,
  noteScatter,
  toNotePosition,
  type NoteBounds,
} from './note-placement'

describe('noteScatter', () => {
  // Pinned: a change here moves every slip on every household's plan.
  it.each([
    ['entry-1', { x: -2, y: -5, tilt: -1.5 }],
    ['entry-2', { x: -7, y: -2, tilt: 1.5 }],
    ['entry-3', { x: -5, y: -1, tilt: 3 }],
    ['cmg1abc0000xyz', { x: 0, y: -3, tilt: -1.75 }],
  ])('maps %s to a fixed offset and tilt', (entryId, expected) => {
    expect(noteScatter(entryId)).toEqual(expected)
  })

  it('returns the same scatter on every call', () => {
    expect(noteScatter('entry-42')).toEqual(noteScatter('entry-42'))
  })

  it('keeps every id inside the ranges, tilted both ways', () => {
    const tilts = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const { x, y, tilt } = noteScatter(`cm${i.toString(36)}entry`)
      expect(x).toBeGreaterThanOrEqual(NOTE_SCATTER_RANGE.x.min)
      expect(x).toBeLessThanOrEqual(NOTE_SCATTER_RANGE.x.max)
      expect(y).toBeGreaterThanOrEqual(NOTE_SCATTER_RANGE.y.min)
      expect(y).toBeLessThanOrEqual(NOTE_SCATTER_RANGE.y.max)
      expect(Math.abs(tilt)).toBeGreaterThanOrEqual(NOTE_SCATTER_RANGE.tilt.min)
      expect(Math.abs(tilt)).toBeLessThanOrEqual(NOTE_SCATTER_RANGE.tilt.max)
      tilts.add(Math.sign(tilt))
    }
    expect(tilts).toEqual(new Set([-1, 1]))
  })
})

describe('clampNotePosition', () => {
  // A desktop planner card's head: tall enough for the slip below the first row.
  const tall: NoteBounds = { width: 400, height: 200, firstRowBottom: 36, menuLeft: 352 }
  // Untilted, so the numbers below are the box's own edges.
  const slip = { width: 120, height: 60, tilt: 0 }

  it('leaves a position inside the head alone', () => {
    expect(clampNotePosition(100, 80, slip, tall)).toEqual({ left: 100, top: 80 })
  })

  it('keeps the slip inside the left and right edges', () => {
    expect(clampNotePosition(-50, 80, slip, tall).left).toBe(NOTE_EDGE_INSET)
    expect(clampNotePosition(500, 80, slip, tall).left).toBe(400 - NOTE_EDGE_INSET - 120)
  })

  it('keeps the slip above the bottom edge', () => {
    expect(clampNotePosition(100, 500, slip, tall).top).toBe(200 - 60)
  })

  it('keeps the slip below the first row', () => {
    expect(clampNotePosition(100, 0, slip, tall).top).toBe(36)
    expect(clampNotePosition(100, -40, slip, tall).top).toBe(36)
  })

  it('lets the slip reach the right edge below the first row', () => {
    // Under the menu's column is fine once the slip is below the menu's row.
    expect(clampNotePosition(500, 100, slip, tall).left).toBe(276)
  })

  describe('on a card too short for the slip below the first row', () => {
    const short: NoteBounds = { width: 400, height: 76, firstRowBottom: 36, menuLeft: 352 }

    it('puts the slip at the bottom', () => {
      expect(clampNotePosition(100, 0, slip, short).top).toBe(16)
      expect(clampNotePosition(100, 50, slip, short).top).toBe(16)
    })

    it('keeps the slip left of the menu', () => {
      expect(clampNotePosition(500, 0, slip, short).left).toBe(352 - NOTE_EDGE_INSET - 120)
    })

    it('uses the right edge on a card without a menu', () => {
      const noMenu = { ...short, menuLeft: null }
      expect(clampNotePosition(500, 0, slip, noMenu).left).toBe(400 - NOTE_EDGE_INSET - 120)
    })
  })

  it('pins a slip wider than the head to the left inset', () => {
    expect(clampNotePosition(50, 80, { ...slip, width: 500 }, tall).left).toBe(NOTE_EDGE_INSET)
  })

  it("keeps a tilted slip's corners inside too", () => {
    // At 3° a 120×60 slip's corners stick out ~1.5px sideways and ~3.1px up
    // and down past its box.
    const tilted = { ...slip, tilt: -3 }
    const overhangX = (120 * Math.cos(Math.PI / 60) + 60 * Math.sin(Math.PI / 60) - 120) / 2
    const overhangY = (120 * Math.sin(Math.PI / 60) + 60 * Math.cos(Math.PI / 60) - 60) / 2

    const topLeft = clampNotePosition(-50, -50, tilted, tall)
    expect(topLeft.left).toBeCloseTo(NOTE_EDGE_INSET + overhangX, 6)
    expect(topLeft.top).toBeCloseTo(36 + overhangY, 6)

    const bottomRight = clampNotePosition(900, 900, tilted, tall)
    expect(bottomRight.left).toBeCloseTo(400 - NOTE_EDGE_INSET - overhangX - 120, 6)
    expect(bottomRight.top).toBeCloseTo(200 - 60 - overhangY, 6)
  })
})

describe('toNotePosition', () => {
  const head = { width: 400, height: 200 }
  const slip = { width: 100, height: 40 }

  it('turns px into fractions of the room the slip moves in', () => {
    // 300px of room across, 160px down.
    expect(toNotePosition(75, 40, slip, head)).toEqual({ x: 0.25, y: 0.25 })
  })

  it('reads flush with each edge as 0 and 1', () => {
    expect(toNotePosition(0, 0, slip, head)).toEqual({ x: 0, y: 0 })
    expect(toNotePosition(300, 160, slip, head)).toEqual({ x: 1, y: 1 })
  })

  it('rounds to four places and stays in 0–1', () => {
    expect(toNotePosition(100, 100, slip, head)).toEqual({ x: 0.3333, y: 0.625 })
    expect(toNotePosition(-5, 900, slip, head)).toEqual({ x: 0, y: 1 })
  })

  it('reads a slip with no room to move as 0', () => {
    expect(toNotePosition(10, 10, head, head)).toEqual({ x: 0, y: 0 })
  })
})
