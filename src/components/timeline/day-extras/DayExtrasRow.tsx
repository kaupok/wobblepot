'use client'

import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { DayExtraView } from '@/components/meal-plan/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Body } from '@/components/ui/typography'
import { ApiError, apiFetch } from '@/lib/api'
import { useEnumLabel, useVaguePhrase } from '@/lib/i18n/enum-label'
import { formatShoppingQuantity } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'

import { ExtraAmountInput } from './ExtraAmountInput'

interface DayExtrasRowProps {
  extras: DayExtraView[]
  /** An extra was removed. Its button leaves with the refresh, so the day moves focus. */
  onRemoved?: () => void
  /** Open this extra's dialog on mount, for stories. */
  defaultOpenId?: string
}

/**
 * A day's extras (HON-1309) in one compact row under its meals: a button per
 * extra, which opens a dialog to change the amount or remove it. Renders
 * nothing for a day with none.
 */
export function DayExtrasRow({ extras, onRemoved, defaultOpenId }: DayExtrasRowProps) {
  const t = useTranslations('meal-plan.extras')
  const labelId = useId()
  const locale = useLocale() as Locale
  const vaguePhrase = useVaguePhrase()
  const pieceLabel = useEnumLabel('Unit', 'piece')

  if (extras.length === 0) return null

  const text = (extra: DayExtraView) =>
    extra.quantity !== null && extra.unit
      ? `${extra.name} ${formatShoppingQuantity(extra.quantity, extra.unit, locale, false, null, vaguePhrase, pieceLabel)}`
      : extra.name

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Body variant="caption" id={labelId}>
        {t('rowLabel')}
      </Body>
      <ul aria-labelledby={labelId} className="flex flex-wrap gap-1">
        {extras.map((extra) => (
          <li key={extra.id}>
            <ExtraButton
              extra={extra}
              text={text(extra)}
              onRemoved={onRemoved}
              defaultOpen={extra.id === defaultOpenId}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function ExtraButton({
  extra,
  text,
  onRemoved,
  defaultOpen,
}: {
  extra: DayExtraView
  text: string
  onRemoved?: () => void
  defaultOpen: boolean
}) {
  const t = useTranslations('meal-plan.extras')
  const [open, setOpen] = useState(defaultOpen)
  const removedRef = useRef(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={t('editLabel', { name: text })}>
          {text}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          // A removed extra's button unmounts with the refresh; focus goes to
          // the day instead of to `<body>` (docs/DESIGN.md → Focus management).
          if (!removedRef.current) return
          event.preventDefault()
          onRemoved?.()
        }}
      >
        <DialogHeader>
          <DialogTitle>{extra.name}</DialogTitle>
          <DialogDescription>
            {extra.ingredientId ? t('editDescription') : t('editTextDescription')}
          </DialogDescription>
        </DialogHeader>
        <EditExtraForm
          extra={extra}
          onClose={() => setOpen(false)}
          onRemoved={() => {
            removedRef.current = true
            setOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditExtraForm({
  extra,
  onClose,
  onRemoved,
}: {
  extra: DayExtraView
  onClose: () => void
  onRemoved: () => void
}) {
  const t = useTranslations('meal-plan.extras')
  const router = useRouter()
  const [quantity, setQuantity] = useState(extra.quantity)

  const logFailure = (action: string, err: Error) =>
    // The route's `error` is English (HON-914): log it, render catalog copy.
    console.error(
      `[edit-extra] ${action} failed`,
      err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
    )

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/extras/${extra.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // 0 reads as "no amount".
        body: JSON.stringify({ quantity: quantity || null }),
      }),
    onSuccess: () => {
      router.refresh()
      onClose()
    },
    onError: (err) => {
      logFailure('save', err)
      toast.error(t('saveFailed'))
    },
  })

  const removeMutation = useMutation({
    mutationFn: () => apiFetch(`/api/extras/${extra.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      router.refresh()
      onRemoved()
    },
    onError: (err) => {
      logFailure('remove', err)
      toast.error(t('removeFailed'))
    },
  })
  const isBusy = saveMutation.isPending || removeMutation.isPending

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!isBusy) saveMutation.mutate()
      }}
    >
      {extra.ingredientId && extra.unit && (
        <ExtraAmountInput
          ingredient={{ unit: extra.unit }}
          value={quantity}
          onValueChange={setQuantity}
          autoFocus
        />
      )}
      <DialogFooter>
        {/* Not `disabled`: a disabled button drops focus (HON-803). */}
        <Button
          type="button"
          variant="destructive"
          aria-disabled={isBusy || undefined}
          onClick={() => {
            if (!isBusy) removeMutation.mutate()
          }}
        >
          {removeMutation.isPending ? t('removing') : t('remove')}
        </Button>
        {extra.ingredientId ? (
          <Button type="submit" aria-disabled={isBusy || undefined}>
            {saveMutation.isPending ? t('saving') : t('save')}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}
