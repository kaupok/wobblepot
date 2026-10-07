'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ApiError, apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

/**
 * The stop page's one button (HON-1084). It POSTs the token to
 * `/api/reminders/stop`, which answers the same for an unknown token, so a
 * second visit to the link shows the same done state.
 */
export function StopRemindersForm({ token }: { token: string }) {
  const t = useTranslations('reminders.stop')
  const doneRef = useRef<HTMLHeadingElement>(null)

  const stop = useMutation({
    mutationFn: () =>
      apiFetch<{ stopped: true }>(
        '/api/reminders/stop',
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
        '[reminders-stop] stop failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      requestRefocus()
    },
  })

  // A disabled button loses focus in Chromium; after a failure, give it back.
  const { ref: buttonRef, requestRefocus } = useRefocusAfterPending(stop.isPending)

  // Success unmounts the button, so focus would fall to <body>. Move it to the
  // heading that replaced it.
  useEffect(() => {
    if (stop.isSuccess) doneRef.current?.focus()
  }, [stop.isSuccess])

  if (stop.isSuccess) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading ref={doneRef} as="h1" variant="h4" tabIndex={-1}>
            {t('doneTitle')}
          </Heading>
          <Body variant="muted" role="status">
            {t.rich('doneBody', {
              link: (chunks) => (
                <Link href="/household" className="text-foreground underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
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
      </CardHeader>
      <CardFooter>
        <div className="flex w-full flex-col gap-4">
          {stop.isError && <FieldError id="stop-error">{t('failed')}</FieldError>}
          <Button
            ref={buttonRef}
            type="button"
            className="w-full"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            aria-describedby={stop.isError ? 'stop-error' : undefined}
          >
            {stop.isPending ? t('submitting') : t('button')}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
