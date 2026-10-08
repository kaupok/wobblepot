'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ApiError, apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

const householdLink = (chunks: ReactNode) => (
  <Link href="/household" className="text-foreground underline underline-offset-2">
    {chunks}
  </Link>
)

/**
 * The confirm page's one button (HON-1113). It POSTs the token to
 * `/api/reminders/confirm`. Opening the link changes nothing, because a mail
 * scanner at a stranger's inbox opens it too; pressing the button is the
 * inbox owner's consent.
 */
export function ConfirmReminderForm({ token, ttlDays }: { token: string; ttlDays: number }) {
  const t = useTranslations('reminders.confirm')
  const outcomeRef = useRef<HTMLHeadingElement>(null)

  const confirm = useMutation({
    mutationFn: () =>
      apiFetch<{ confirmed: boolean }>(
        '/api/reminders/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        },
        t('failed'),
      ),
    onError: (err) => {
      // The route's `error` is English: log it, render catalog copy.
      // eslint-disable-next-line no-console
      console.error(
        '[reminders-confirm] confirm failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      requestRefocus()
    },
  })

  // A disabled button loses focus in Chromium; after a failure, give it back.
  const { ref: buttonRef, requestRefocus } = useRefocusAfterPending(confirm.isPending)

  // Success unmounts the button, so focus would fall to <body>. Move it to the
  // heading that replaced it.
  useEffect(() => {
    if (confirm.isSuccess) outcomeRef.current?.focus()
  }, [confirm.isSuccess])

  if (confirm.isSuccess) {
    const { confirmed } = confirm.data
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading ref={outcomeRef} as="h1" variant="h4" tabIndex={-1}>
            {confirmed ? t('confirmedTitle') : t('expiredTitle')}
          </Heading>
          <Body variant="muted" role="status">
            {confirmed
              ? t.rich('confirmedBody', { link: householdLink })
              : t.rich('expiredBody', { days: ttlDays, link: householdLink })}
          </Body>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading as="h1" variant="h4">
          {t('title')}
        </Heading>
        <Body variant="muted">{t('intro')}</Body>
      </CardHeader>
      <CardFooter>
        <div className="flex w-full flex-col gap-4">
          {confirm.isError && <FieldError id="confirm-error">{t('failed')}</FieldError>}
          <Button
            ref={buttonRef}
            type="button"
            className="w-full"
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending}
            aria-describedby={confirm.isError ? 'confirm-error' : undefined}
          >
            {confirm.isPending ? t('submitting') : t('button')}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
