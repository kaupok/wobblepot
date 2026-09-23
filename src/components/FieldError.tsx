import React from 'react'
import { Body } from '@/components/ui/typography'

type FieldErrorProps = Omit<React.HTMLAttributes<HTMLParagraphElement>, 'role'>

/**
 * A form or field error message. Every form error renders through this so each
 * one is styled the same and announced the same way: `role="alert"` makes a
 * screen reader read it the moment it appears. Pass `id` when an input points
 * at it through `aria-describedby`.
 */
export const FieldError = React.forwardRef<HTMLParagraphElement, FieldErrorProps>((props, ref) => (
  <Body ref={ref} variant="small" tone="destructive" role="alert" {...props} />
))
FieldError.displayName = 'FieldError'
