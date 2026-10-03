import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'

/**
 * Lets a tap open a Radix `Tooltip`. Radix opens a tooltip on hover and on
 * keyboard focus, never on touch, and closes it on pointerdown and on click, so
 * on a phone the label behind an icon is out of reach. The cook view is used on
 * a phone propped on a counter (HON-1023), so its icon marks open on a tap.
 *
 * Spread `rootProps` on `Tooltip` and `triggerProps` on `TooltipTrigger`. A tap
 * (any pointer but a mouse) toggles the tooltip: the state at pointerdown is
 * kept, because Radix's own pointerdown closes it first, and the click then
 * prevents Radix's close. A mouse and the keyboard keep Radix's behaviour.
 * With `enabled` false only the state is lifted, so behaviour is unchanged.
 */
export function useTapTooltip(enabled = true) {
  const [open, setOpen] = useState(false)
  // `null` when the press is not a tap; otherwise whether it was open before.
  const wasOpenAtTap = useRef<boolean | null>(null)

  const triggerProps = enabled
    ? {
        onPointerDown: (event: PointerEvent) => {
          wasOpenAtTap.current = event.pointerType === 'mouse' ? null : open
        },
        onClick: (event: MouseEvent) => {
          if (wasOpenAtTap.current === null) return
          // Composed ahead of Radix's handler, which skips a prevented event.
          event.preventDefault()
          setOpen(!wasOpenAtTap.current)
          wasOpenAtTap.current = null
        },
      }
    : {}

  return { rootProps: { open, onOpenChange: setOpen }, triggerProps }
}
