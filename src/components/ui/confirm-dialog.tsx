'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTranslations } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Defaults to `common.confirm`. */
  confirmLabel?: string
  /** Defaults to `common.cancel`. */
  cancelLabel?: string
  /** Defaults to `common.loading`. */
  loadingLabel?: string
  onConfirm: () => void
  variant?: 'default' | 'destructive'
  isLoading?: boolean
  /**
   * Passed to `AlertDialogContent`. A dialog opened from state has no trigger
   * for Radix to return focus to, so the caller calls `preventDefault()` and
   * focuses the control that opened it (CLAUDE.md → Focus management).
   */
  onCloseAutoFocus?: (event: Event) => void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loadingLabel,
  onConfirm,
  variant = 'default',
  isLoading = false,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  const t = useTranslations('common')
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>{cancelLabel ?? t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={isLoading}
            className={cn(variant === 'destructive' && buttonVariants({ variant: 'destructive' }))}
          >
            {isLoading ? (loadingLabel ?? t('loading')) : (confirmLabel ?? t('confirm'))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
