'use client'

import {
  Children,
  useCallback,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react'
import Image from 'next/image'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { MealImageStatus } from '@/generated/prisma/enums'
import type { NotePlacement } from './note-placement'

/** The image columns a meal payload carries (HON-735, HON-744). */
export interface MealImageFields {
  /** Illustration in Vercel Blob, set once `imageStatus` is `ready` */
  imageUrl?: string | null
  imageStatus?: MealImageStatus
  /** OKLCH hue in degrees taken from the image — the one per-meal colour */
  imageHue?: number | null
}

/**
 * The rendered width of each image box (`IMAGE_BOX`), so `next/image` fetches a
 * file sharp at the device's pixel ratio (HON-748). Each is an upper bound: an
 * over-estimate costs a few KB, an under-estimate a soft image.
 *
 * The widest side card is a planner row at the 1152px page width: 1fr beside
 * the 320px sidebar, ~776px. Its image is 5/8 of that, 485px; with trailing
 * actions it ends `right-12` (48px) earlier, 437px. Below `md` the card is
 * `100vw - 2rem` at most, so 5/8 of it stays under 62vw and the trailing box
 * under 55vw.
 *
 * The bottom image spans the card. Two callsites: the alternatives grid (three
 * ~272px columns from `md` in the `max-w-4xl` add-meal dialog) and the recipe
 * library grid (two 360px columns at `md`, three 320–363px from `lg` up to
 * the 1152px page width). 364px covers both; below `md` no card is wider than
 * the viewport.
 *
 * Measuring these in a browser: `img.naturalWidth` is density-corrected (file
 * width × `sizes` length / candidate `w`), so it reads back roughly the `sizes`
 * value, not the file. Load `img.currentSrc` into a `new Image()` for the file.
 */
const SIZES = {
  default: '(min-width: 768px) 485px, 62vw',
  trailingActions: '(min-width: 768px) 437px, 55vw',
  bottom: '(min-width: 768px) 364px, 100vw',
} as const

/**
 * Where the image sits in the card. Nothing the user reads or taps sits on its
 * opaque part (docs/DESIGN.md → Imagery → Cards).
 *
 * With trailing actions the image ends before the action column instead of
 * fading under it (HON-749). A right-end fade was the alternative, but a phone
 * card has room for the title, the actions and ~100px between them, not for an
 * image underneath the actions as well. `right-12` (48px) is the column — the
 * `icon-sm` menu, which holds Note as well as Swap and Clear —
 * plus the card's `px-4`. The inset box can be narrower than 3:2, so
 * `object-cover` may crop the plate at its right edge; the short right fade
 * keeps that from reading as a hard edge.
 *
 * The narrow/wide switch is a container query on the card (`@md`, 448px), not
 * a viewport breakpoint: the alternatives grid puts ~250px cards on a desktop
 * screen, and those need the narrow geometry as much as a phone does.
 */
const IMAGE_BOX = {
  default: 'right-0 w-9/20 @md/meal-image:w-5/8',
  trailingActions: 'right-12 left-1/3 @md/meal-image:left-3/8 mask-r-from-80%',
} as const

/**
 * How tall the side image is (HON-927). `card` runs it down the card's full
 * height: the recipes list, where nothing runs across the width.
 *
 * A card with a `head` holds the image in the head instead, so it ends where
 * the full-width rows below (a past card's status and rating) begin, and those
 * rows sit on the plain tint rather than the dish (HON-755). The head sits
 * inside the card's `py-2` and is followed by its `gap-2` (Card `size="sm"`),
 * so `-inset-y-2` takes the image up to the card's top edge and down to the
 * next row's top edge, or the card's bottom edge when there is no next row —
 * the same box `card` gives. Change them together. `headWithRows` adds a
 * bottom fade, so an image that ends mid-card doesn't cut the plate with a
 * hard edge. A title that wraps makes the head, and so the plate, taller. The
 * note is not a row: it lies over the plate (`overlay`, HON-974), so a
 * planned card with a note keeps the full-height plate.
 */
const IMAGE_HEIGHT = {
  card: 'inset-y-0',
  headOnly: '-inset-y-2',
  headWithRows: '-inset-y-2 mask-b-from-60%',
} as const

type ImageHeight = keyof typeof IMAGE_HEIGHT

/**
 * Where the `overlay` (the planner card's note) lies by default: the head's
 * bottom-right corner, over the plate, so the card is the same shape with or
 * without it (HON-974). The head ends inside the card's `py-2`, which is the
 * slip's vertical inset. The wrapper hugs the slip, so only the slip takes
 * clicks.
 *
 * The right edge is the image box's: `right-13` keeps the ⋯ column
 * (`right-12`) clear however tall the slip grows, with 4px so the slip's
 * tilted corner doesn't touch it, and `right-4` is the card's `px-4` on a card
 * without actions.
 *
 * The left edge is the width cap (`max-w-note-slip*` in globals.css). It is not
 * the trailing image box's: that starts at a third on a narrow card, under the
 * badge row, where the availability badge runs to about 54% of a phone card in
 * Estonian ("Vaja osta 2 koostisosa", 177px of 356px). So the slip starts no
 * further left than 11/20 plus 8px, and half plus 8px on a wide card, where
 * 3/8 of a 448px card would still be under that badge. Both clear the title
 * cap (`TITLE_WIDTH`, at most half). A cap rather than a left inset, so a slip
 * dragged elsewhere keeps its width (HON-975). Change them together, and with
 * `NOTE_SCATTER_RANGE`, which only moves the slip left and up from here.
 */
const OVERLAY_ANCHOR = {
  default: 'right-4 bottom-0 max-w-note-slip @md/meal-image:max-w-note-slip-md',
  trailingActions:
    'right-13 bottom-0 max-w-note-slip-actions @md/meal-image:max-w-note-slip-actions-md',
} as const

/**
 * The default anchor, moved by the slip's own scatter (HON-975). No transition:
 * the slip is where it is, and a drag must follow the pointer.
 */
const OVERLAY_SCATTER = 'translate-x-(--note-x) translate-y-(--note-y)'

/**
 * A slip the household placed, with the same width cap as the anchor
 * (HON-975). The saved fractions are of the room the slip has to move in
 * (`toNotePosition`), so it lies at that fraction of the head, pulled back by
 * the same fraction of its own size: at 0 it is flush with the left or top
 * edge, at 1 with the right or bottom one. No measuring, so the server render
 * is right, and on a card where the slip wraps taller it still stays on.
 */
// `w-max`: anchored by its left edge, the wrapper would otherwise shrink to
// the room left of the head's right edge, rewrap the slip, and move it by
// its own changed width.
const OVERLAY_PLACED_BOX =
  'left-(--note-left) top-(--note-top) w-max -translate-x-(--note-left) -translate-y-(--note-top)'
const OVERLAY_PLACED = {
  default: `${OVERLAY_PLACED_BOX} max-w-note-slip @md/meal-image:max-w-note-slip-md`,
  trailingActions: `${OVERLAY_PLACED_BOX} max-w-note-slip-actions @md/meal-image:max-w-note-slip-actions-md`,
} as const

/**
 * The note editor, wherever the slip lies: it is open for seconds and needs
 * room for Cancel and Save, which a phone's narrow column doesn't have, so it
 * may lie over the title while it is open. It still keeps clear of the ⋯
 * column.
 */
const OVERLAY_WIDE = {
  default: 'right-4 bottom-0 left-0 flex justify-end pl-4',
  trailingActions: 'right-12 bottom-0 left-0 flex justify-end pr-1 pl-4',
} as const

/** The custom properties the overlay's classes read: the scatter, the tilt, and a saved place. */
function overlayStyle({ scatter, position }: NotePlacement): CSSProperties {
  return {
    '--note-x': `${scatter.x}px`,
    '--note-y': `${scatter.y}px`,
    '--note-tilt': `${scatter.tilt}deg`,
    ...(position && {
      '--note-left': `${position.x * 100}%`,
      '--note-top': `${position.y * 100}%`,
    }),
  } as CSSProperties
}

/**
 * The widest the title may be on a tinted card: it wraps before it reaches the
 * image's opaque part. Fractions of the card's content row, matched to
 * `IMAGE_BOX` plus the 30% fade — change the two together.
 *
 * Keyed on the card's own `data-meal-surface` rather than the meal's fields: a
 * card whose image fails to load drops it, and its title gets the full row
 * back with it. A neutral surface (an image without a hue) keeps the cap.
 *
 * A card with an `overlay` (`data-meal-overlay`) keeps the cap without an
 * image too, so the title wraps before the note's slip (`OVERLAY_BOX`) rather
 * than running under it (HON-974).
 */
const TITLE_WIDTH = {
  default:
    'group-data-meal-surface/meal-image:max-w-1/2 group-data-meal-overlay/meal-image:max-w-1/2 @md/meal-image:group-data-meal-surface/meal-image:max-w-3/8 @md/meal-image:group-data-meal-overlay/meal-image:max-w-3/8',
  trailingActions:
    'group-data-meal-surface/meal-image:max-w-1/3 group-data-meal-overlay/meal-image:max-w-1/3 @md/meal-image:group-data-meal-surface/meal-image:max-w-3/8 @md/meal-image:group-data-meal-overlay/meal-image:max-w-3/8',
} as const

/** The `max-width` classes for a title inside a `MealImageCard`, matching its image box. */
export function mealImageTitleWidth(trailingActions = false): string {
  return trailingActions ? TITLE_WIDTH.trailingActions : TITLE_WIDTH.default
}

/**
 * The `max-width` for the head's badge rows on a card with an `overlay`: half
 * the content row, which ends before the slip's left edge (`OVERLAY_BOX`) at
 * any width, so a second badge wraps rather than running under the slip
 * (HON-974): the servings override after the pantry badge, and on a short
 * card, which the slip spans top to bottom, the first row's protein and
 * own-recipe badges. A single badge
 * wider than that overflows the cap rather than wrapping; the slip's left
 * edge is set to clear the widest one. Without an overlay the row is uncapped.
 */
export const MEAL_IMAGE_BADGE_ROW_WIDTH = 'group-data-meal-overlay/meal-image:max-w-1/2'

/**
 * The hue to tint with, or null when the meal renders the neutral card: no
 * image, not `ready`, or no hue (docs/DESIGN.md → Imagery, "Absence renders
 * the neutral card"). A meal with an image but no hue still shows the image,
 * on the neutral card (HON-754).
 */
export function mealTintHue(meal: MealImageFields): number | null {
  if (meal.imageStatus !== 'ready' || !meal.imageUrl) return null
  return meal.imageHue ?? null
}

/**
 * Whether an image has loaded, for its fade-in (docs/DESIGN.md → Imagery,
 * "Arrival is a fade"). `onLoad` alone misses an image that finished before
 * React attached the handler — a cache hit, or a load that beat hydration —
 * and leaves it at opacity 0 for good (HON-754), so the ref checks as well.
 * Reset by remounting: callers key the image by its URL.
 */
export function useImageLoaded() {
  const [loaded, setLoaded] = useState(false)
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true)
  }, [])
  const onLoad = useCallback(() => setLoaded(true), [])
  return { loaded, ref, onLoad }
}

/** The value for the `style` prop of an element that carries `data-meal-surface`. */
export function mealHueStyle(hue: number): CSSProperties {
  return { '--meal-hue': hue } as CSSProperties
}

/**
 * `side` blends the image into the right of the card behind the content, for
 * wide, short cards. `bottom` puts it below the content as a 3:2 block fading
 * upward, for cards taller than wide: a side column on a portrait card crops
 * the plate to a zoomed vertical slice under the text (HON-750).
 */
export type MealImageLayout = 'side' | 'bottom'

interface MealImageCardProps extends ComponentProps<typeof Card> {
  meal: MealImageFields & { name: string }
  /** Where the image sits. Defaults to `side`. */
  layout?: MealImageLayout
  /**
   * The card has an action column at the right end of its first row (the
   * planner card's menu, beside the slot badge). The image then ends before
   * it. `side` only.
   */
  trailingActions?: boolean
  /**
   * The card's head: the rows from the slot badge down to the badge row. The
   * side image is bounded by it, and `children` become the rows below it, on
   * the plain tint (HON-927). `side` only; the card must be `size="sm"`.
   * Any child counts as a row, even an element that renders nothing, so leave
   * a row out rather than render an empty one.
   */
  head?: ReactNode
  /**
   * Laid over the head's bottom-right corner, on the plate, rather than added
   * as a row: the planner card's note (HON-974). It is not a lower row, so it
   * neither grows the card nor ends the image. It follows `head` in the DOM,
   * so reading and focus order are the head's, then the overlay, then the
   * rows. `side` with a `head` only.
   */
  overlay?: ReactNode
  /** The overlay may lie over the head's whole width (the note editor). */
  overlayWide?: boolean
  /**
   * The overlay's own offset and tilt, and the place the household dragged it
   * to, if any (HON-975). Without it the overlay rests in the corner at the
   * default tilt.
   */
  overlayPlacement?: NotePlacement
  /**
   * Rendered after the image, so a `bottom` card keeps its actions (the
   * alternative card's Select button) below the picture.
   */
  footer?: ReactNode
}

/**
 * A `Card` that takes its meal's colour (HON-746, `docs/DESIGN.md` → Imagery):
 * tinted with the meal's `imageHue`, with the illustration blended into the
 * right of the card, or below its content with `layout="bottom"`. A meal
 * without an image is a plain `Card` — no tint, no image element, nothing
 * reserved while it generates. A meal with an image but no hue keeps the
 * image on an untinted surface (`data-meal-surface="neutral"`: the tint's
 * lightness at zero chroma, globals.css).
 *
 * With a `head`, the side image is bounded by the head rather than the card,
 * and `children` are the full-width rows below it (HON-927). An `overlay` lies
 * over the head's bottom-right corner without adding a row (HON-974).
 *
 * The children are the card's content, unchanged: the tint re-scopes the theme
 * tokens (`[data-meal-surface]` in globals.css), so nothing inside needs a
 * tinted variant, and the image sits behind the content in the card's own
 * stacking context, so nothing inside moves.
 */
export function MealImageCard({
  meal,
  layout = 'side',
  trailingActions = false,
  head,
  overlay,
  overlayWide = false,
  overlayPlacement,
  footer,
  className,
  style,
  children,
  ...props
}: MealImageCardProps) {
  // Keyed by URL so a new image after an edit gets its own chance to load.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)
  const hue = mealTintHue(meal)
  const imageUrl = meal.imageStatus === 'ready' ? meal.imageUrl : null

  // A URL that no longer resolves is an absent image: the card goes neutral
  // rather than keeping a tint with nothing to explain it. Errors are silent.
  const hasImage = !!imageUrl && imageUrl !== brokenUrl
  // An image without a hue is still shown, on the neutral card: a picture
  // that was generated and paid for is never hidden by its colour (HON-754).
  const tinted = hasImage && hue !== null
  const hasHead = layout === 'side' && head !== undefined
  const hasOverlay = hasHead && !!overlay
  // `toArray` drops `null`, `false` and `undefined`, so a lower row that is
  // switched off doesn't end the image mid-card. The overlay is not a row.
  const hasLowerRows = Children.toArray(children).length > 0 || footer != null
  const side = trailingActions ? 'trailingActions' : 'default'
  const overlayPlaced = !!overlayPlacement?.position
  const height: ImageHeight = !hasHead ? 'card' : hasLowerRows ? 'headWithRows' : 'headOnly'

  const image = hasImage ? (
    <CardImage
      key={imageUrl}
      src={imageUrl}
      alt={meal.name}
      layout={layout}
      trailingActions={trailingActions}
      height={height}
      onError={() => setBrokenUrl(imageUrl)}
    />
  ) : null

  // One tree for both states, with the image in slots of its own around the
  // content: the tint can switch on mid-session (an image generated from the
  // detail modal), and moving `children` to a different position would
  // remount the whole card — including the trigger the modal returns focus to.
  return (
    <Card
      // `neutral` keeps the geometry and the title cap below, but not the
      // colour: globals.css gives it the tint's lightness at zero chroma.
      data-meal-surface={tinted ? '' : hasImage ? 'neutral' : undefined}
      data-meal-overlay={hasOverlay ? '' : undefined}
      className={cn(
        hasImage && 'relative isolate overflow-hidden',
        // The named group and container drive the side image's geometry, the
        // overlay's box and the title cap (`mealImageTitleWidth`). A bottom
        // card leaves them off, so its title keeps the full row: nothing sits
        // beside it.
        (hasImage || hasOverlay) && layout === 'side' && 'group/meal-image @container/meal-image',
        className,
      )}
      // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
      style={tinted ? { ...style, ...mealHueStyle(hue) } : style}
      {...props}
    >
      {hasHead ? (
        // Rendered with or without an image, so the head never remounts when
        // the image arrives or fails.
        <div data-slot="meal-image-head" className="relative">
          {image}
          {head}
          {hasOverlay && (
            // The wide box is wider than a short slip, so it lets clicks
            // through to the title beside it; only the slip itself takes them.
            <div
              data-slot="meal-image-overlay"
              data-placed={overlayPlaced ? '' : undefined}
              className={cn(
                'pointer-events-none absolute *:pointer-events-auto',
                overlayWide
                  ? OVERLAY_WIDE[side]
                  : overlayPlaced
                    ? OVERLAY_PLACED[side]
                    : cn(OVERLAY_ANCHOR[side], overlayPlacement && OVERLAY_SCATTER),
              )}
              // eslint-disable-next-line shadcn/no-inline-styles -- the slip's scatter, tilt and saved place are per entry (HON-975), like --meal-hue below; the classes read them.
              style={overlayPlacement && overlayStyle(overlayPlacement)}
            >
              {overlay}
            </div>
          )}
        </div>
      ) : layout === 'side' ? (
        image
      ) : (
        head
      )}
      {children}
      {layout === 'bottom' ? image : null}
      {footer}
    </Card>
  )
}

interface CardImageProps {
  src: string
  alt: string
  layout: MealImageLayout
  trailingActions: boolean
  height: ImageHeight
  onError: () => void
}

function CardImage({ src, alt, layout, trailingActions, height, onError }: CardImageProps) {
  const { loaded, ref, onLoad } = useImageLoaded()
  const bottom = layout === 'bottom'

  return (
    // Side: -z-10 inside the card's `isolate`, above the tint, below the content.
    // The blend and the fade sit on this wrapper, not the img: a positioned
    // element with a z-index is its own isolated group, so a blend on the img
    // would multiply against nothing and leave the white surface white.
    <div
      data-testid="meal-card-image"
      className={cn(
        'mix-blend-multiply',
        bottom
          ? // In flow, below the content, so nothing overlaps it. The top 40%
            // fades into the tint above; the full 3:2 frame shows the whole plate.
            'relative aspect-3/2 w-full shrink-0 mask-t-from-60%'
          : cn(
              'absolute -z-10 mask-l-from-30%',
              IMAGE_HEIGHT[height],
              trailingActions ? IMAGE_BOX.trailingActions : IMAGE_BOX.default,
            ),
      )}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes={bottom ? SIZES.bottom : trailingActions ? SIZES.trailingActions : SIZES.default}
        ref={ref}
        onLoad={onLoad}
        onError={onError}
        className={cn(
          'object-cover transition-opacity duration-200 ease-out',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}
