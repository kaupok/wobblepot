'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { ApiError, apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

/**
 * The invite-request form on `/request-invite` (HON-846). One field; a
 * successful submit replaces the form with "check your email", whatever the
 * address, because the route answers the same for every one of them.
 *
 * `source` is the page's `?ref=` (HON-1089), sent as `ref` when present. The
 * route decides whether it is valid, so the form shows nothing for it.
 */
export function RequestInviteForm({ source }: { source?: string }) {
  const t = useTranslations('auth.requestInvite')
  const locale = useLocale()
  const [email, setEmail] = useState('')
  const sentRef = useRef<HTMLParagraphElement>(null)

  const request = useMutation({
    mutationFn: (address: string) =>
      apiFetch<{ ok: true }>(
        '/api/waitlist',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: address, locale, ...(source ? { ref: source } : {}) }),
        },
        t('failed'),
      ),
    onError: (err) => {
      // The route's `error` is English: log it, render catalog copy.
      // eslint-disable-next-line no-console
      console.error(
        '[request-invite] request failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      requestRefocus()
    },
  })

  // A disabled button loses focus in Chromium; after a failure, give it back.
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(request.isPending)

  // Success unmounts the button, so focus would fall to <body>. Move it to the
  // message that replaced the form.
  useEffect(() => {
    if (request.isSuccess) sentRef.current?.focus()
  }, [request.isSuccess])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    request.mutate(email.trim())
  }

  const errorMessage = request.isError
    ? request.error instanceof ApiError && request.error.status === 429
      ? t('tooManyRequests')
      : t('failed')
    : null

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading as="h1" variant="h4">
          {t('title')}
        </Heading>
        <Body variant="muted">{t('description')}</Body>
      </CardHeader>
      {request.isSuccess ? (
        <CardContent>
          <Body
            ref={sentRef}
            tabIndex={-1}
            variant="paragraph"
            tone="success"
            role="status"
            data-testid="form-success"
          >
            {t('sent', { email: request.variables ?? '' })}
          </Body>
        </CardContent>
      ) : (
        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{t('emailLabel')}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={request.isPending}
                  aria-invalid={!!errorMessage}
                  aria-describedby={errorMessage ? 'form-error' : undefined}
                />
              </div>
              {errorMessage && <FieldError id="form-error">{errorMessage}</FieldError>}
            </div>
          </CardContent>
          <CardFooter className="pt-6">
            <div className="flex w-full flex-col gap-4">
              <Button ref={submitRef} type="submit" className="w-full" disabled={request.isPending}>
                {request.isPending ? t('submitting') : t('submit')}
              </Button>
              <Body variant="muted">
                {t.rich('privacy', {
                  link: (chunks) => (
                    <Link href="/privacy" className="text-foreground underline underline-offset-2">
                      {chunks}
                    </Link>
                  ),
                })}
              </Body>
              <Body variant="muted">{t('householdInvitee')}</Body>
            </div>
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
