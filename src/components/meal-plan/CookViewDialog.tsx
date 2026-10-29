'use client'

import { useTranslations } from 'next-intl'
import type { ReactNode, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import { displayFont } from '@/components/landing/display-font'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Heading } from '@/components/ui/typography'
import type { MealImageState } from '@/hooks/use-meal-image'
import { useWakeLock } from '@/hooks/use-wake-lock'
import { cn } from '@/lib/utils'

import { MealImage } from './MealImage'
import { mealHueStyle, mealTintHue } from './MealImageCard'
import { MyRecipeIcon } from './MyRecipeIcon'

/** What the shell hands its body: `MealDetail`'s `image` and `title`. */
export interface CookViewParts {
  image: ReactNode
  title: ReactNode
}

interface CookViewDialogProps {
  meal: { name: string; isCustom?: boolean }
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The meal's illustration, from `useMealImage`, which the caller owns. */
  image: MealImageState
  /** Under the name, inside the title block: the planned entry's conflict badges. */
  belowTitle?: ReactNode
  /** The dialog's panel, for a caller that moves focus back into it. */
  contentRef?: RefObject<HTMLDivElement | null>
  /** The view has closed and focus is back on its opener. */
  onClosed?: () => void
  /** The view's body: `MealDetail`, given the hero and the title. */
  children: (parts: CookViewParts) => ReactNode
}

/** Input types that take no typed text, so have no edit for Escape to cancel. */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'file',
  'color',
  'range',
])

/** Whether Escape on `target` belongs to a field editing text in place. */
function isTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type)
}

/**
 * The cook view's dialog: the full-screen panel, its tint, the hero, the
 * title, the phone's sticky bar, the wake lock, and focus in and out. The
 * planned entry's view (`MealDetailModal`) and the My recipes view
 * (`RecipeDetailModal`, HON-1338) each fill it with `MealDetail` and their own
 * wiring.
 */
export function CookViewDialog({
  meal,
  open,
  onOpenChange,
  image,
  belowTitle,
  contentRef: callerContentRef,
  onClosed,
  children,
}: CookViewDialogProps) {
  const tDetail = useTranslations('meal-plan.detail')
  const ownContentRef = useRef<HTMLDivElement>(null)
  const contentRef = callerContentRef ?? ownContentRef
  // A URL that no longer resolves is an absent image: the hero renders
  // nothing, and the panel drops the tint that came with it (as
  // `MealImageCard` does). Keyed by URL so a new image gets its own chance.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null)

  // The cook view keeps the screen on while it is open (HON-932).
  useWakeLock(open)

  // The control that opened the view: the card's meal name. The dialog opens
  // from state, with no `DialogTrigger`, so Radix has nothing to return focus
  // to and drops it on `<body>` (docs/DESIGN.md → Focus management). Captured as
  // the dialog opens, before focus moves into it.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // The surface follows `MealImageCard`'s rules: a hue tints the whole panel,
  // an image without one gets the `neutral` surface, and no image (or one
  // still generating) leaves the plain background.
  const { status: imageStatus, imageUrl, imageHue } = image
  const hasImage = imageStatus === 'ready' && !!imageUrl && imageUrl !== brokenUrl
  const hue = hasImage ? mealTintHue({ imageStatus, imageUrl, imageHue }) : null
  const surface = hasImage ? (hue === null ? 'neutral' : '') : undefined
  const showHero = hasImage || imageStatus === 'generating'

  // The phone's sticky bar: once the title has scrolled up under the bar, the
  // bar takes the tint and shows the meal's name. The bar is hidden from
  // `lg`, where the title sits in a column that never scrolls under it.
  //
  // Observed against the scroll region, not the viewport: the region starts
  // under the panel's safe-area padding, as the bar does, so the -60px top
  // margin (the bar's `h-15`) is the bar's bottom edge on a notched phone too.
  // Against the viewport it would sit a whole inset (59px on an iPhone 14
  // Pro) above the bar, and the bar would tint only once the title was gone.
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null)
  const [titleHidden, setTitleHidden] = useState(false)
  useEffect(() => {
    if (!titleEl || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setTitleHidden(!!entry && !entry.isIntersecting),
      {
        root: titleEl.closest('[data-slot="cook-view-scroll"]'),
        rootMargin: '-60px 0px 0px 0px',
      },
    )
    observer.observe(titleEl)
    return () => {
      observer.disconnect()
      setTitleHidden(false)
    }
  }, [titleEl])

  // For "My recipe", the name split before its last word, so the icon can
  // hold on to that word; null without the icon. A one-word name has an empty
  // head.
  const nameParts = meal.isCustom ? /^(.*?)(\S*)\s*$/s.exec(meal.name) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        size="fullscreen"
        // With the icon inside the title, the title's text would name the
        // dialog "<meal> My recipe", so the dialog takes the meal name alone.
        // Radix spreads these after its own `aria-labelledby`.
        {...(nameParts && { 'aria-label': meal.name, 'aria-labelledby': undefined })}
        data-meal-surface={surface}
        // eslint-disable-next-line shadcn/no-inline-styles -- --meal-hue is the one per-meal value (docs/DESIGN.md → Imagery); every colour is derived from it by [data-meal-surface] in globals.css.
        style={hue === null ? undefined : mealHueStyle(hue)}
        // Focus the panel itself, not its first control: the note editor or
        // an ingredient checkbox would pop a keyboard or a focus ring on open.
        // A screen reader announces the dialog by its title and description.
        // Radix still traps focus while it is open.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
          contentRef.current?.focus()
        }}
        // Escape in the note or the "Serves" field cancels that field, not
        // the view (HON-949). The field's own handler still runs; Radix
        // listens on the document, so stopping the event there is not enough,
        // and the planner card's `NoteEditor` must keep its behaviour.
        onEscapeKeyDown={(event) => {
          if (isTextField(event.target)) event.preventDefault()
        }}
        // Back to the control that opened it, if it is still on the page.
        // Then hand over to the caller (`onClosed`): the view has unmounted,
        // so a dialog it opens never stacks on this one, and that dialog's
        // focus scope starts from the card.
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current
          returnFocusRef.current = null
          if (target?.isConnected) {
            event.preventDefault()
            target.focus()
          }
          onClosed?.()
        }}
      >
        <DialogDescription className="sr-only">
          {tDetail('ariaDetailsFor', { mealName: meal.name })}
        </DialogDescription>

        {/* Phone only. Transparent over the hero, where it shows nothing but
            the close button beside it, and lets taps through to the hero.
            Once opaque it takes them itself: a tap on the bar must not land
            on a checkbox or "How to prepare" scrolled out of sight under it.
            The name is a visual repeat of the title, so it stays out of the
            accessibility tree. */}
        <div
          data-testid="cook-view-bar"
          data-title-hidden={titleHidden ? '' : undefined}
          className={cn(
            'absolute inset-x-0 top-0 z-10 flex h-15 items-center pr-20 pl-5 transition-colors duration-200 ease-out md:pr-24 md:pl-8 lg:hidden',
            titleHidden ? 'bg-card' : 'pointer-events-none bg-transparent',
          )}
        >
          <p
            aria-hidden="true"
            className={cn(
              'truncate text-lg font-semibold transition-opacity duration-200 ease-out',
              titleHidden ? 'opacity-100' : 'opacity-0',
            )}
          >
            {meal.name}
          </p>
        </div>

        {children({
          image: showHero ? (
            <MealImage
              mealName={meal.name}
              status={imageStatus}
              imageUrl={imageUrl}
              imageHue={imageHue}
              onError={setBrokenUrl}
            />
          ) : null,
          // "My recipe" follows the name, as on the cards (HON-1023), in one
          // `nowrap` span with the name's last word: the browser breaks
          // before the icon's inline-flex box even after a no-break space,
          // which left the icon alone on a line (HON-1469).
          // The wrapper sets `--font-bricolage` for the brand face: the dialog
          // portals to <body>, outside any element that sets it.
          title: (
            <div className={displayFont.variable}>
              <Heading ref={setTitleEl} variant="display" face="brand">
                <DialogTitle asChild>
                  {nameParts ? (
                    <span>
                      {nameParts[1]}
                      <span className="whitespace-nowrap">
                        {nameParts[2]}
                        {'\u00a0'}
                        <MyRecipeIcon size="lg" />
                      </span>
                    </span>
                  ) : (
                    <span>{meal.name}</span>
                  )}
                </DialogTitle>
              </Heading>
              {belowTitle}
            </div>
          ),
        })}
      </DialogContent>
    </Dialog>
  )
}
