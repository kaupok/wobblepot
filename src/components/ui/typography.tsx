import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import React from 'react'

// Variant type exports for type reusability
export type HeadingVariant = 'h1' | 'h2' | 'h3' | 'h4'
export type BodyVariant = 'default' | 'lead' | 'large' | 'small' | 'muted'

// Heading component with variants for h1-h4
const headingVariants = cva('scroll-m-20 font-extrabold tracking-tight', {
  variants: {
    variant: {
      h1: 'text-4xl lg:text-5xl',
      h2: 'text-3xl font-semibold border-b pb-2 first:mt-0',
      h3: 'text-2xl font-semibold',
      h4: 'text-xl font-semibold',
    },
  },
  defaultVariants: {
    variant: 'h1',
  },
})

interface HeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {}

const tagMap = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
} as const

export const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, variant, ...props }, ref) => {
    const effectiveVariant = variant ?? 'h1'
    const Tag = tagMap[effectiveVariant]
    return React.createElement(Tag, {
      ref,
      className: cn(headingVariants({ variant }), className),
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
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

interface BodyProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof bodyVariants> {}

export const Body = React.forwardRef<HTMLParagraphElement, BodyProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <p ref={ref} className={cn(bodyVariants({ variant }), className)} {...props} />
  ),
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
  ({ className, ...props }, ref) => <li ref={ref} className={className} {...props} />,
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
      className={cn(
        'bg-muted my-6 overflow-x-auto rounded-lg border p-4 font-mono text-sm',
        className,
      )}
      {...props}
    />
  ),
)
Pre.displayName = 'Pre'
