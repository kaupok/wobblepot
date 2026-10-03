'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import {
  clampNotePosition,
  toNotePosition,
  type NoteBounds,
  type NotePosition,
} from './note-placement'

/** A press that moves less than this is a click, and opens the editor. */
export const NOTE_DRAG_THRESHOLD = 4
/** An arrow key moves the slip this far; with Shift, `NOTE_KEY_STEP_LARGE`. */
export const NOTE_KEY_STEP = 8
export const NOTE_KEY_STEP_LARGE = 32
/** A keyboard move is saved once the keys have been still this long. */
export const NOTE_KEY_SAVE_DELAY = 400

const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

interface UseNoteDragOptions {
  planId: string
  entryId: string
  /** The saved place, or null for the slip's default place. */
  initialPosition: NotePosition | null
  /** The card's first row: the slip stays below it. */
  firstRowRef: RefObject<HTMLElement | null>
  /** The ⋯ menu, which the slip never covers. */
  menuRef: RefObject<HTMLElement | null>
  /** The slip's tilt in degrees, so the clamp holds for its corners. */
  tilt: number
  /** The id of the element that renders `hint`, the slip's accessible description. */
  hintId: string
}

interface Measured {
  bounds: NoteBounds
  slip: { width: number; height: number; tilt: number }
  /** The slip's untransformed top-left in the head, where it lies now. */
  left: number
  top: number
}

/**
 * The slip's size and place, and the bounds it moves in: the overlay wrapper
 * hugs the slip and is not rotated, and the card head is what it is
 * positioned in.
 */
function measureOverlay(
  wrapper: HTMLElement,
  head: HTMLElement,
  firstRow: HTMLElement | null,
  menu: HTMLElement | null,
  tilt: number,
): Measured {
  const headBox = head.getBoundingClientRect()
  const wrapperBox = wrapper.getBoundingClientRect()
  const firstRowBox = firstRow?.getBoundingClientRect()
  const menuBox = menu?.getBoundingClientRect()
  return {
    bounds: {
      width: head.clientWidth,
      height: head.clientHeight,
      firstRowBottom: firstRowBox ? firstRowBox.bottom - headBox.top : 0,
      menuLeft: menuBox ? menuBox.left - headBox.left : null,
    },
    // The rect rather than `offsetWidth`, which rounds to whole px.
    slip: { width: wrapperBox.width, height: wrapperBox.height, tilt },
    left: wrapperBox.left - headBox.left,
    top: wrapperBox.top - headBox.top,
  }
}

/**
 * Drag a planner card's note slip to a new place on its card, with the pointer
 * or the arrow keys, and save the place for the household (HON-975).
 *
 * The slip's box comes from the overlay wrapper around it, which hugs the slip
 * and is not rotated, and the bounds from the card head that wrapper is
 * positioned in. Measured on each press or key, so a card that changed height
 * since (a title that rewraps) clamps against its real size.
 */
export function useNoteDrag({
  planId,
  entryId,
  initialPosition,
  firstRowRef,
  menuRef,
  tilt,
  hintId,
}: UseNoteDragOptions) {
  const t = useTranslations('meal-plan.noteEditor')
  const [position, setPosition] = useState<NotePosition | null>(initialPosition)
  // What the server holds: the place a failed save goes back to.
  const savedRef = useRef<NotePosition | null>(initialPosition)
  // The last place a move asked for. A failed save only reverts the slip if
  // nothing moved it since: a later move is already on its way to the server.
  const latestMoveRef = useRef<NotePosition | null>(null)
  // A saved place re-clamped to this card's current size, for display only
  // (see the layout effect below). Keyed by the place it was fitted from.
  const [fitted, setFitted] = useState<{ from: NotePosition; to: NotePosition } | null>(null)
  const pressRef = useRef<{
    pointerId: number
    x: number
    y: number
    start: Measured
    dragging: boolean
    /** Where the last move put the slip: what a drop saves. */
    moved: NotePosition | null
  } | null>(null)
  // A drop ends in a click on the slip; this stops it opening the editor.
  // Cleared by the next press or key too: a release outside the slip fires
  // no click, and the flag must not swallow the one after it.
  const suppressClickRef = useRef(false)
  const keySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearKeySaveTimer = useCallback(() => {
    if (keySaveTimerRef.current) clearTimeout(keySaveTimerRef.current)
    keySaveTimerRef.current = null
  }, [])
  useEffect(() => clearKeySaveTimer, [clearKeySaveTimer])

  const saveMutation = useMutation({
    // One at a time, in order: two quick drops must reach the server in the
    // order they were made, or the earlier one would win.
    scope: { id: `note-position-${entryId}` },
    mutationFn: (next: NotePosition) =>
      apiFetch(
        `/api/meal-plans/${planId}/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noteX: next.x, noteY: next.y }),
        },
        t('moveFailed'),
      ),
    onSuccess: (_data, next) => {
      savedRef.current = next
    },
    // Optimistic: the slip already lies where it was dropped. A failure puts
    // it back where the server has it, unless the slip has moved again since.
    // The server's error prose is English; the localized copy is always shown.
    onError: (_error, failed) => {
      if (latestMoveRef.current !== failed) return
      latestMoveRef.current = null
      setPosition(savedRef.current)
      toast.error(t('moveFailed'))
    },
  })
  const { mutate: save } = saveMutation

  function measure(slipElement: HTMLElement): Measured | null {
    const wrapper = slipElement.closest<HTMLElement>('[data-slot="meal-image-overlay"]')
    const head = wrapper?.closest<HTMLElement>('[data-slot="meal-image-head"]')
    return wrapper && head
      ? measureOverlay(wrapper, head, firstRowRef.current, menuRef.current, tilt)
      : null
  }

  function moveTo(measured: Measured, left: number, top: number): NotePosition {
    const clamped = clampNotePosition(left, top, measured.slip, measured.bounds)
    const next = toNotePosition(clamped.left, clamped.top, measured.slip, measured.bounds)
    latestMoveRef.current = next
    setPosition(next)
    return next
  }

  // A saved place is a fraction of the room the slip had where it was set. On
  // a card that is shorter now (a swap to a one-line name, a narrower screen),
  // the same fraction can lie over the first row and the ⋯ menu. Re-clamp it
  // to the card as it is, for display only: the saved place is the
  // household's, and on a card that grows again it is right again. The
  // observer reports once on `observe`, so this also runs on mount.
  useLayoutEffect(() => {
    const head = firstRowRef.current?.closest<HTMLElement>('[data-slot="meal-image-head"]')
    const wrapper = head?.querySelector<HTMLElement>(':scope > [data-slot="meal-image-overlay"]')
    if (!position || !head || !wrapper || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // The wide editor box is not where the slip lies: nothing to fit.
      if (!wrapper.hasAttribute('data-placed')) return
      const measured = measureOverlay(wrapper, head, firstRowRef.current, menuRef.current, tilt)
      const roomX = measured.bounds.width - measured.slip.width
      const roomY = measured.bounds.height - measured.slip.height
      const left = position.x * Math.max(0, roomX)
      const top = position.y * Math.max(0, roomY)
      const clamped = clampNotePosition(left, top, measured.slip, measured.bounds)
      const moved = Math.abs(clamped.left - left) > 0.5 || Math.abs(clamped.top - top) > 0.5
      setFitted(
        moved
          ? {
              from: position,
              to: toNotePosition(clamped.left, clamped.top, measured.slip, measured.bounds),
            }
          : null,
      )
    })
    observer.observe(head)
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [position, firstRowRef, menuRef, tilt])

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    suppressClickRef.current = false
    if (event.button !== 0 || !event.isPrimary) return
    const start = measure(event.currentTarget)
    if (!start) return
    pressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start,
      dragging: false,
      moved: null,
    }
    // Moves and the release reach the slip even when the pointer outruns it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // A synthetic pointer (a test's) is not an active one and cannot be
      // captured; it is dispatched to the slip anyway.
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const press = pressRef.current
    if (!press || press.pointerId !== event.pointerId) return
    const dx = event.clientX - press.x
    const dy = event.clientY - press.y
    if (!press.dragging && Math.hypot(dx, dy) < NOTE_DRAG_THRESHOLD) return
    press.dragging = true
    press.moved = moveTo(press.start, press.start.left + dx, press.start.top + dy)
  }

  function onPointerUp(event: React.PointerEvent<HTMLElement>) {
    const press = pressRef.current
    if (!press || press.pointerId !== event.pointerId) return
    pressRef.current = null
    if (!press.moved) return
    suppressClickRef.current = true
    // The slip stays where the last move put it: no snap on release.
    clearKeySaveTimer()
    save(press.moved)
  }

  // The browser took the gesture over: nothing was dropped, so the slip goes
  // back to where it was saved.
  function onPointerCancel(event: React.PointerEvent<HTMLElement>) {
    const press = pressRef.current
    if (!press || press.pointerId !== event.pointerId) return
    pressRef.current = null
    if (press.dragging) setPosition(savedRef.current)
  }

  function onClickCapture(event: React.MouseEvent<HTMLElement>) {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    suppressClickRef.current = false
    const step = ARROW_STEPS[event.key]
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return
    const measured = measure(event.currentTarget)
    if (!measured) return
    // The arrows move the slip, not the page.
    event.preventDefault()
    const distance = event.shiftKey ? NOTE_KEY_STEP_LARGE : NOTE_KEY_STEP
    const next = moveTo(
      measured,
      measured.left + step[0] * distance,
      measured.top + step[1] * distance,
    )
    clearKeySaveTimer()
    keySaveTimerRef.current = setTimeout(() => {
      keySaveTimerRef.current = null
      save(next)
    }, NOTE_KEY_SAVE_DELAY)
  }

  /** The note was cleared: the server dropped its place too, and a new note starts at the default. */
  const reset = useCallback(() => {
    clearKeySaveTimer()
    savedRef.current = null
    latestMoveRef.current = null
    setPosition(null)
  }, [clearKeySaveTimer])

  return {
    /** Where the slip lies: the saved or moved place, fitted to the card as it is now. */
    position: fitted && fitted.from === position ? fitted.to : position,
    reset,
    /** Says the slip moves with the arrow keys (WCAG 2.5.7); render it, hidden, at `hintId`. */
    hint: t('moveHint'),
    /** Spread onto the saved note's button. `touch-none`: a finger drag moves the slip instead of the page. */
    slipProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
      onKeyDown,
      'aria-describedby': hintId,
      className: 'touch-none',
    },
  }
}
