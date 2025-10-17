import { cn } from '@/lib/utils'
import React from 'react'

// H1 - Page headings
export const H1 = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h1
      ref={ref}
      className={cn('text-4xl font-extrabold tracking-tight lg:text-5xl', className)}
      {...props}
    />
  ),
)
H1.displayName = 'H1'

// H2 - Major section headings
export const H2 = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('text-3xl font-semibold tracking-tight', className)} {...props} />
  ),
)
H2.displayName = 'H2'

// H3 - Subsection headings
export const H3 = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-2xl font-semibold tracking-tight', className)} {...props} />
  ),
)
H3.displayName = 'H3'

// H4 - Minor headings
export const H4 = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h4 ref={ref} className={cn('text-xl font-semibold tracking-tight', className)} {...props} />
  ),
)
H4.displayName = 'H4'

// P - Paragraph text
export const P = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('leading-7', className)} {...props} />
  ),
)
P.displayName = 'P'

// Blockquote
export const Blockquote = React.forwardRef<
  HTMLQuoteElement,
  React.HTMLAttributes<HTMLQuoteElement>
>(({ className, ...props }, ref) => (
  <blockquote
    ref={ref}
    className={cn('border-border text-muted-foreground border-l-2 italic', className)}
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

// Small text
export const Small = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <small ref={ref} className={cn('text-sm leading-none font-medium', className)} {...props} />
  ),
)
Small.displayName = 'Small'

// Lead text - Larger introductory text
export const Lead = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-muted-foreground text-xl', className)} {...props} />
))
Lead.displayName = 'Lead'

// Muted text
export const Muted = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn('text-muted-foreground text-sm', className)} {...props} />
  ),
)
Muted.displayName = 'Muted'
