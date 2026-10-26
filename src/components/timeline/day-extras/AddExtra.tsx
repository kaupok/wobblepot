'use client'

import { useId, useState, type FormEvent, type Ref, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import { useIngredientSearch, type IngredientResult } from '@/hooks/use-ingredient-search'
import { ApiError, apiFetch } from '@/lib/api'
import { DAY_EXTRA_LABEL_MAX } from '@/lib/day-extras/schemas'
import { ExtraAmountInput } from './ExtraAmountInput'

/** Catalogue matches shown at once, so a broad search does not push the text row away. */
const MATCHES_SHOWN = 8

type CreateBody = { ingredientId: string; quantity: number | null } | { label: string }

interface AddExtraProps {
  date: string
  /** The day as its heading reads it, e.g. "Saturday Oct 17" or "Tomorrow". */
  dayLabel: string
  /** The "+ Extra" button, which takes focus after an extra is removed. */
  buttonRef?: Ref<HTMLButtonElement>
  /** Open on mount, for stories. */
  defaultOpen?: boolean
  /**
   * Opened from the day's "+ Add" menu rather than its own button (HON-1335):
   * the parent owns `open`, and focus goes back to `returnFocusRef` on close,
   * because a dialog with no trigger has nowhere else to send it.
   */
  controlled?: {
    open: boolean
    onOpenChange: (open: boolean) => void
    returnFocusRef: RefObject<HTMLButtonElement | null>
  }
}

/**
 * The picker for an extra on a day (HON-1309): a catalogue ingredient with an
 * optional amount, or the household's own words. A day with no empty slot
 * shows its "+ Extra" button, the dialog's trigger, so Radix returns focus to
 * it on close; a day with one opens it from the "+ Add" menu (`controlled`).
 */
export function AddExtra({
  date,
  dayLabel,
  buttonRef,
  defaultOpen = false,
  controlled,
}: AddExtraProps) {
  const t = useTranslations('meal-plan.extras')
  const [ownOpen, setOwnOpen] = useState(defaultOpen)
  const open = controlled ? controlled.open : ownOpen
  const setOpen = controlled ? controlled.onOpenChange : setOwnOpen

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          {/* "Extra" is the visible text; the name adds the day. */}
          <Button
            ref={buttonRef}
            variant="ghost"
            size="sm"
            aria-label={t('addLabel', { day: dayLabel })}
          >
            <Plus aria-hidden="true" />
            {t('button')}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={
          controlled
            ? (event) => {
                event.preventDefault()
                controlled.returnFocusRef.current?.focus()
              }
            : undefined
        }
      >
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>
        {/* Mounted with the content, so each open starts from an empty search. */}
        <AddExtraForm date={date} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AddExtraForm({ date, onClose }: { date: string; onClose: () => void }) {
  const t = useTranslations('meal-plan.extras')
  const router = useRouter()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<IngredientResult | null>(null)
  const [quantity, setQuantity] = useState<number | null>(null)
  const search = useIngredientSearch(query)
  const matches = (search.data ?? []).slice(0, MATCHES_SHOWN)
  const text = query.trim().slice(0, DAY_EXTRA_LABEL_MAX)

  const addMutation = useMutation({
    mutationFn: (body: CreateBody) =>
      apiFetch('/api/extras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...body }),
      }),
    onSuccess: () => {
      router.refresh()
      onClose()
    },
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[add-extra] add failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      const pastDay = err instanceof ApiError && err.code === 'past_date'
      toast.error(pastDay ? t('pastDay') : t('addFailed'))
    },
  })
  const isAdding = addMutation.isPending

  function add(body: CreateBody) {
    if (!isAdding) addMutation.mutate(body)
  }

  function submitAmount(event: FormEvent) {
    event.preventDefault()
    // 0 reads as "no amount", which the route stores as null.
    if (picked) add({ ingredientId: picked.id, quantity: quantity || null })
  }

  if (picked) {
    return (
      <form onSubmit={submitAmount} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Body variant="paragraph">{picked.name}</Body>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
            {t('pickAnother')}
          </Button>
        </div>
        <ExtraAmountInput
          ingredient={picked}
          value={quantity}
          onValueChange={setQuantity}
          autoFocus
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          {/* Not `disabled`: a disabled button drops focus (HON-803). */}
          <Button type="submit" aria-disabled={isAdding || undefined}>
            {isAdding ? t('adding') : t('add')}
          </Button>
        </DialogFooter>
      </form>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={searchId}>{t('search')}</Label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          autoComplete="off"
          autoFocus
        />
        {matches.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {matches.map((ingredient) => (
              <li key={ingredient.id}>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('pick', { name: ingredient.name })}
                  onClick={() => {
                    setPicked(ingredient)
                    setQuantity(null)
                  }}
                >
                  {ingredient.name}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          text &&
          (search.isFetching ? (
            <Body variant="muted">{t('searching')}</Body>
          ) : (
            search.isSuccess && <Body variant="muted">{t('noMatch', { query: text })}</Body>
          ))
        )}
        {text && (
          <div className="flex flex-col gap-1">
            <div>
              {/* A long query truncates rather than widen the dialog. */}
              <Button
                variant="outline"
                size="sm"
                className="max-w-full"
                aria-disabled={isAdding || undefined}
                onClick={() => add({ label: text })}
              >
                <Plus aria-hidden="true" />
                <span className="truncate">{t('addAsText', { query: text })}</span>
              </Button>
            </div>
            <Body variant="muted">{t('textNote')}</Body>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
      </DialogFooter>
    </>
  )
}
