import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const inputVariants = cva(
  [
    'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-1 transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
  ],
  {
    variants: {
      // Each size matches the Button size of the same name, so a field and
      // the button beside it stay the same height at every viewport.
      size: {
        // `h-touch md:h-10`, as Button's default; the text drops a step from
        // `md` (18px to 16px on this scale), where a cursor, not a thumb, uses
        // the field.
        default: 'h-touch text-base md:h-10 md:text-sm',
        // Button `lg`, with Button's 16px text (`text-sm` on this scale) at
        // every width: the cook view's Ask field sits beside `lg` chips and
        // Send, and all three read the same from the counter (HON-1022).
        lg: 'h-12 text-sm md:h-11',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

// `size` is the variant, not the native attribute (a width in characters),
// which no field here uses.
function Input({
  className,
  type,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
