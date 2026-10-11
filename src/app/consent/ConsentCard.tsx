'use client'

import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { SCOPE_MESSAGE_KEYS, type McpScope } from '@/lib/mcp/oauth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body, Ul, Li } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

interface ConsentCardProps {
  /** `invalid`: the signed request is missing, expired, or names no known client. */
  status: 'ready' | 'invalid'
  /** The client's self-declared name; null when it sent none. */
  clientName?: string | null
  /** Where the answer is sent: the signed redirect URI's host, or a native app's scheme. */
  redirectTarget?: string
  /** The signed-in user's household; null before onboarding. */
  householdName?: string | null
  scopes?: McpScope[]
}

/**
 * The consent step of an MCP client's OAuth authorization (HON-1150): the
 * user allows or denies the app. Both answers go to the provider's consent
 * endpoint; the auth client forwards the signed query from the page URL
 * (`oauthProviderClient`) and, on success, its redirect plugin sends the
 * browser to the client's redirect URI, with a code or with
 * `error=access_denied`. The card does not navigate itself: a second
 * navigation would restart the first, and the aborted request can still reach
 * the client with a single-use code.
 */
export function ConsentCard({
  status,
  clientName = null,
  redirectTarget = '',
  householdName = null,
  scopes = [],
}: ConsentCardProps) {
  const t = useTranslations('auth.connect')

  const consent = useMutation({
    mutationFn: async (accept: boolean) => {
      const result = await authClient.oauth2.consent({ accept })
      if (result.error) throw result.error
      return result.data
    },
    onError: (error, accept) => {
      // The provider's error text is English and protocol-level; log it and
      // show catalog copy (CLAUDE.md → Localization).
      console.error('[consent] request failed', error)
      if (accept) refocusAllow()
      else refocusDeny()
    },
  })

  // Both buttons stay disabled once the answer is in: the browser is leaving.
  const isBusy = consent.isPending || consent.isSuccess
  const { ref: allowRef, requestRefocus: refocusAllow } = useRefocusAfterPending(isBusy)
  const { ref: denyRef, requestRefocus: refocusDeny } = useRefocusAfterPending(isBusy)
  const pendingAnswer = isBusy ? consent.variables : undefined

  if (status === 'invalid') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading as="h1" variant="h4">
            {t('invalid.title')}
          </Heading>
        </CardHeader>
        <CardContent>
          <Body>{t('invalid.body')}</Body>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">{t('invalid.action')}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading as="h1" variant="h4">
          {clientName ? t('title', { clientName }) : t('titleUnnamed')}
        </Heading>
        <Body variant="muted">
          {clientName ? t('description', { clientName }) : t('descriptionUnnamed')}
        </Body>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* The name is self-declared and anyone can register an app, so the
              destination is how the user tells the real connector from a look-alike. */}
          <Body>{t('redirectsTo', { target: redirectTarget })}</Body>
          {householdName && <Body>{t('household', { householdName })}</Body>}
          <div className="flex flex-col gap-2">
            <Body>{t('scopesHeading')}</Body>
            <Ul>
              {scopes.map((scope) => (
                <Li key={scope}>{t(`scopes.${SCOPE_MESSAGE_KEYS[scope]}`)}</Li>
              ))}
            </Ul>
          </div>
          <Body variant="muted">{t('readOnly')}</Body>
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex w-full flex-col gap-4">
          {consent.isError && <FieldError>{t('failed')}</FieldError>}
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row">
            <Button
              ref={denyRef}
              variant="outline"
              className="w-full sm:flex-1"
              disabled={isBusy}
              onClick={() => consent.mutate(false)}
            >
              {pendingAnswer === false ? t('denying') : t('deny')}
            </Button>
            <Button
              ref={allowRef}
              className="w-full sm:flex-1"
              disabled={isBusy}
              onClick={() => consent.mutate(true)}
            >
              {pendingAnswer === true ? t('allowing') : t('allow')}
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  )
}
