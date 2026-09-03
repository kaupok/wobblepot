import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import React from 'react'

// Variant type exports for type reusability
export type HeadingVariant = 'h1' | 'h2' | 'h3' | 'h4' | 'section'
export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'div'
export type BodyVariant = 'default' | 'lead' | 'large' | 'small' | 'muted' | 'caption'

// Heading component. `variant` picks the visual level from the type scale;
// `as` picks the HTML tag for the document outline. They are independent —
// see docs/DESIGN.md -> Type scale.
const headingVariants = cva('scroll-m-20 tracking-tight', {
  variants: {
    variant: {
      h1: 'text-4xl lg:text-5xl font-extrabold',
      h2: 'text-3xl font-semibold border-b pb-2',
      h3: 'text-2xl font-semibold',
      h4: 'text-xl font-semibold',
      section: 'text-base font-semibold',
    },
  },
  defaultVariants: {
    variant: 'h1',
  },
})

interface HeadingProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof headingVariants> {
  /**
   * HTML tag to render. Defaults to the variant's natural tag, so passing only
   * `variant` keeps size and outline in step. Override it when the surrounding
   * outline needs a different level than the type scale calls for — e.g. `h3`
   * inside a Dialog whose title is already an `h2`.
   */
  as?: HeadingTag
}

/** The tag each variant renders when `as` is not given. */
const tagMap = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  section: 'h2',
} as const satisfies Record<HeadingVariant, HeadingTag>

export const Heading = React.forwardRef<HTMLElement, HeadingProps>(
  ({ className, variant, as, ...props }, ref) => {
    const effectiveVariant = variant ?? 'h1'
    const Tag = as ?? tagMap[effectiveVariant]
    return React.createElement(Tag, {
      ref,
      className: cn(headingVariants({ variant: effectiveVariant }), className),
      ...props,
    })
  },
)
Heading.displayName = 'Heading'

// Body component with variants for different text styles
const bodyVariants = cva('', {
  variants: {
    variant: {
      default: 'leading-7',
      lead: 'text-xl text-muted-foreground',
      large: 'text-lg font-semibold',
      small: 'text-sm font-medium leading-none',
      muted: 'text-sm text-muted-foreground',
      caption: 'text-xs font-medium text-muted-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

interface BodyProps
  extends React.HTMLAttributes<HTMLParagraphElement>, VariantProps<typeof bodyVariants> {}

export const Body = React.forwardRef<HTMLParagraphElement, BodyProps>(
  ({ className, variant, ...props }, ref) => {
    const effectiveVariant = variant ?? 'default'
    return (
      <p
        ref={ref}
        className={cn(bodyVariants({ variant: effectiveVariant }), className)}
        {...props}
      />
    )
  },
)
Body.displayName = 'Body'

// Blockquote
export const Blockquote = React.forwardRef<
  HTMLQuoteElement,
  React.HTMLAttributes<HTMLQuoteElement>
>(({ className, ...props }, ref) => (
  <blockquote
    ref={ref}
    className={cn('border-border text-muted-foreground border-l-2 pl-6 italic', className)}
    {...props}
  />
))
Blockquote.displayName = 'Blockquote'

// List - Unordered list
export const Ul = React.forwardRef<HTMLUListElement, React.HTMLAttributes<HTMLUListElement>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('my-6 ml-6 list-disc [&>li]:mt-2', className)} {...props} />
  ),
)
Ul.displayName = 'Ul'

// List - Ordered list
export const Ol = React.forwardRef<HTMLOListElement, React.HTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn('my-6 ml-6 list-decimal [&>li]:mt-2', className)} {...props} />
  ),
)
Ol.displayName = 'Ol'

// List item
export const Li = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn(className)} {...props} />,
)
Li.displayName = 'Li'

// Code - Inline code
export const Code = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <code
      ref={ref}
      className={cn(
        'bg-muted text-foreground relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
        className,
      )}
      {...props}
    />
  ),
)
Code.displayName = 'Code'

// Pre - Code block
export const Pre = React.forwardRef<HTMLPreElement, React.HTMLAttributes<HTMLPreElement>>(
  ({ className, ...props }, ref) => (
    <pre
      ref={ref}
      className={cn('bg-muted overflow-x-auto rounded-lg border p-4 font-mono text-sm', className)}
      {...props}
    />
  ),
)
Pre.displayName = 'Pre'
