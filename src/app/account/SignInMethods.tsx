'use client'

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { ApiError } from '@/lib/api'
import {
  GOOGLE_LINK_CALLBACK_URL,
  GOOGLE_PROVIDER_ID,
  SIGN_IN_ACCOUNTS_QUERY_KEY,
  findGoogleAccount,
  hasPasswordAccount,
  toSignInAccounts,
  type GoogleLinkLanding,
  type SignInAccount,
} from '@/lib/sign-in-methods'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Body, Heading } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'

interface SignInMethodsProps {
  /** Read by the page on the server, so the list is right on the first paint. */
  initialAccounts: SignInAccount[]
  /**
   * The account email, shown on the Google row. `listAccounts` returns no
   * provider email, and linking refuses a Google address that differs
   * (`allowDifferentEmails` is off), so the two are the same.
   */
  email: string
  /** `isGoogleAuthConfigured()`. Off: the password row only. */
  googleEnabled: boolean
  /** What the Connect callback left in the URL, from `parseGoogleLinkLanding`. */
  landing: GoogleLinkLanding | null
}

/** The params the Connect callback adds to `/account`. */
const LANDING_PARAMS = ['linked', 'error'] as const

/**
 * "Sign-in methods" on My account → Profile (HON-1158): a row for the
 * password and one for Google.
 *
 * - Connect, when Google is on and not linked, starts `linkSocial`; the
 *   callback returns to `/account?linked=google`, with `&error=<code>` on a
 *   failure, and this section says how it went, once.
 * - Disconnect, only when a password exists too: without it the account would
 *   have no way in, and Better Auth refuses to unlink the last account anyway.
 */
export function SignInMethods({
  initialAccounts,
  email,
  googleEnabled,
  landing,
}: SignInMethodsProps) {
  const t = useTranslations('account.signInMethods')
  const tErrors = useTranslations('errors.auth')
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!landing) return
    const url = new URL(window.location.href)
    for (const param of LANDING_PARAMS) url.searchParams.delete(param)
    // Native `replaceState`: the App Router syncs with it, and keeping
    // `history.state` keeps the router's own entry intact.
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [landing])

  const { data: accounts = initialAccounts, isError } = useQuery({
    queryKey: SIGN_IN_ACCOUNTS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await authClient.listAccounts()
      if (error) throw new ApiError(error.message ?? '', error.status, { code: error.code })
      return toSignInAccounts(data ?? [])
    },
    initialData: initialAccounts,
  })

  const hasPassword = hasPasswordAccount(accounts)
  const google = findGoogleAccount(accounts)

  const connect = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.linkSocial({
        provider: GOOGLE_PROVIDER_ID,
        callbackURL: GOOGLE_LINK_CALLBACK_URL,
        errorCallbackURL: GOOGLE_LINK_CALLBACK_URL,
      })
      if (error) throw new ApiError(error.message ?? '', error.status, { code: error.code })
    },
    onError: (error) => {
      // The server string is English and is logged, not shown (CLAUDE.md → Localization).
      console.error('[sign-in-methods] connect failed', error)
      requestConnectRefocus()
    },
  })
  // On success the auth client is already sending the browser to Google, so
  // the button stays disabled until the page leaves.
  const isConnecting = connect.isPending || connect.isSuccess
  const { ref: connectRef, requestRefocus: requestConnectRefocus } =
    useRefocusAfterPending(isConnecting)

  const disconnect = useMutation({
    mutationFn: async (account: SignInAccount) => {
      const { error } = await authClient.unlinkAccount({ accountId: account.id })
      if (error) throw new ApiError(error.message ?? '', error.status, { code: error.code })
    },
    onSuccess: (_data, account) => {
      queryClient.setQueryData<SignInAccount[]>(SIGN_IN_ACCOUNTS_QUERY_KEY, (old) =>
        old?.filter((row) => row.id !== account.id),
      )
      toast.success(t('disconnected'))
    },
    onError: (error) => {
      console.error('[sign-in-methods] disconnect failed', error)
      requestDisconnectRefocus()
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SIGN_IN_ACCOUNTS_QUERY_KEY }),
  })
  const { ref: disconnectRef, requestRefocus: requestDisconnectRefocus } = useRefocusAfterPending(
    disconnect.isPending,
  )

  // Disconnect went away with the Google account, so focus moves to the
  // Connect button that replaced it instead of falling to the page.
  const disconnected = disconnect.isSuccess && !google
  useEffect(() => {
    if (disconnected) connectRef.current?.focus()
  }, [disconnected, connectRef])

  const actionError = connect.isError
    ? connectErrorMessage(connect.error)
    : disconnect.isError
      ? disconnectErrorMessage(disconnect.error)
      : null

  return (
    <section aria-labelledby="sign-in-methods-heading" className="flex flex-col gap-3">
      <Heading variant="section" as="h2" id="sign-in-methods-heading">
        {t('heading')}
      </Heading>
      <Body variant="muted">{t('description')}</Body>

      {landing?.kind === 'linked' && (
        <Callout tone="success" role="status">
          {t('connected')}
        </Callout>
      )}
      {landing?.kind === 'failed' && (
        <Callout tone="warning" role="status">
          {tErrors(landing.errorKey)}
        </Callout>
      )}
      {isError && <Body tone="destructive">{t('loadFailed')}</Body>}

      <ul className="flex flex-col divide-y">
        <li className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Body>{t('password')}</Body>
            <Body variant="muted">{hasPassword ? t('passwordSet') : t('passwordNotSet')}</Body>
          </div>
        </li>
        {googleEnabled && (
          <li className="flex flex-wrap items-center justify-between gap-3 py-3">
            {/* `break-all`: an address has no break point, and a long one would overflow at 360px. */}
            <div className="flex min-w-0 flex-col gap-1 break-all">
              <Body>{t('google')}</Body>
              <Body variant="muted">{google ? email : t('googleNotConnected')}</Body>
            </div>
            {!google && (
              <Button
                ref={connectRef}
                type="button"
                variant="outline"
                disabled={isConnecting}
                onClick={() => connect.mutate()}
              >
                {isConnecting ? t('connecting') : t('connect')}
              </Button>
            )}
            {google && hasPassword && (
              <Button
                ref={disconnectRef}
                type="button"
                variant="outline"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate(google)}
              >
                {disconnect.isPending ? t('disconnecting') : t('disconnect')}
              </Button>
            )}
          </li>
        )}
      </ul>

      {actionError && <FieldError>{actionError}</FieldError>}
    </section>
  )

  function connectErrorMessage(error: Error): string {
    if (error instanceof ApiError && error.status === 429) return tErrors('tooManyAttempts')
    return t('connectFailed')
  }

  function disconnectErrorMessage(error: Error): string {
    if (error instanceof ApiError) {
      if (error.status === 429) return tErrors('tooManyAttempts')
      // `/unlink-account` wants a session younger than a day (`freshAge`).
      if (error.code === 'SESSION_NOT_FRESH') return t('signInAgain')
    }
    return t('disconnectFailed')
  }
}
