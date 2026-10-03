import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Press feedback is a 0.97 scale on `:active` (docs/DESIGN.md → Motion): a phone
// has no hover, so a tap is otherwise silent until its result arrives. The
// transition names its properties rather than animating every change. `link`
// opts out of the scale below. `aria-disabled` looks the same as `disabled` but
// keeps the button focusable, for a pending action whose handler guards itself
// — a disabled button drops focus to the page body (HON-803).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        // A ghost that recedes: secondary actions beside content (copy list,
        // dismiss, "add note", unlink) that should not compete with it until
        // pointed at. Was `ghost` + `text-muted-foreground` at each callsite.
        quiet:
          'text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent/50',
        // The one remove/delete treatment for a row: muted at rest, destructive
        // on hover. Confirmation is the `ConfirmDialog`'s job, so the icon does
        // not need to shout before it is pressed.
        'quiet-destructive':
          'text-muted-foreground hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
        // A `link` that recedes: one item in a row of muted text links (the
        // footer's cookie settings), matching their colour, weight and hover.
        'quiet-link': 'text-muted-foreground font-normal hover:underline active:scale-100',
      },
      // Control height is `touch` (44px) below `md` and 40px from `md` up — a
      // thumb on a phone, a cursor on a dashboard. `sm` stays at 32px: it is
      // for secondary inline actions in card rows, where 44px zones with a 6px
      // gap would overlap. See docs/DESIGN.md → Spacing, radius, elevation.
      size: {
        default: 'h-touch md:h-10 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-12 md:h-11 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-touch md:size-10',
        'icon-sm': 'size-8',
        // An icon inside a line of small text (the nutrition (i), HON-930): a
        // 16px box keeps the line its own height, and the `::after` reaches 4px
        // past it on every side, so the target is 24px (WCAG 2.5.8).
        'icon-xs': 'relative size-4 after:absolute after:-inset-1',
        // The same pattern for an icon inside a `display` heading (the cook
        // view's "My recipe" after the meal name, HON-1023): a 24px box keeps
        // the title's line height, and the `::after` reaches 10px past it, so
        // the target is the cook view's 44px floor. The icon grows with the
        // title, 20px then 24px from `lg`.
        'icon-display':
          "relative size-6 after:absolute after:-inset-2.5 [&_svg:not([class*='size-'])]:size-5 lg:[&_svg:not([class*='size-'])]:size-6",
        'icon-lg': 'size-12 md:size-11',
        // `icon-lg` below `lg`, then as wide as its text: a control whose label
        // shows only from `lg` (`hidden lg:inline`), with the icon alone on a
        // phone row that needs the width for its text (the cook view's Ask,
        // HON-981). Keep an `aria-label` that contains the visible label.
        'icon-lg-to-lg': 'size-12 md:size-11 lg:w-auto lg:px-4',
        // A `link` inside running text: no box, so it sits on the sentence's
        // line instead of a control's. Not a touch target on its own — use it
        // only where the surrounding text is the tap area's context.
        // It wraps like the text around it rather than running out of a narrow
        // column (the shopping panel's "Plus 8 more" line, HON-947).
        inline: 'h-auto p-0 has-[>svg]:px-0 whitespace-normal text-left',
      },
      // `pill` rounds the control fully, for a button that sits inside a
      // rounded-full surface — the header's pills — where a `rounded-md` hover
      // box or filled button clashes with the curve around it. Listed after
      // `size` so it wins over the `rounded-md` that `sm` and `lg` restate.
      shape: {
        default: '',
        pill: 'rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      shape: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  shape = 'default',
  asChild = false,
  type = 'button',
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      type={type}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      className={cn(buttonVariants({ variant, size, shape, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
