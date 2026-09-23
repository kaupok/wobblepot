import { useTranslations } from 'next-intl'
import { Pre } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

interface ErrorDetailsProps {
  error: Error
  /** Placement only (margin) — the block renders nothing in production. */
  className?: string
  /**
   * Whether to render at all. Defaults to development builds only: a stack
   * trace is for the developer, never the user.
   */
  visible?: boolean
}

/**
 * The collapsible message-and-stack block every route `error.tsx` shows in
 * development. The trace sits inside a summary already labelled as details, so
 * it renders as a plain `Pre` with no colour or size of its own.
 */
export function ErrorDetails({
  error,
  className,
  visible = process.env.NODE_ENV === 'development',
}: ErrorDetailsProps) {
  const t = useTranslations('errors.boundary')
  if (!visible) return null
  return (
    <details className={cn('text-left', className)}>
      <summary className="cursor-pointer font-semibold">{t('detailsLabel')}</summary>
      <Pre>
        {error.message}
        {error.stack && `\n\n${error.stack}`}
      </Pre>
    </details>
  )
}
