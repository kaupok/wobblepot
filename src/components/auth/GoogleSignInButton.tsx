'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Body } from '@/components/ui/typography'

/**
 * Google's "G" mark, in its four brand colours. Google's sign-in branding
 * guidelines govern the mark only; the button around it is ours
 * (docs/DESIGN.md).
 */
function GoogleMark() {
  /* eslint-disable shadcn/no-raw-colors -- Google's sign-in branding guidelines fix the "G" mark's four colours; no theme token may stand in for them. */
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className="size-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
  /* eslint-enable shadcn/no-raw-colors */
}

interface GoogleSignInButtonProps {
  onClick: () => void
  /** The request to start the Google flow is in flight; the page is about to leave. */
  pending?: boolean
  disabled?: boolean
}

/**
 * "Continue with Google" on `/sign-in` and `/sign-up` (HON-1157). The forms
 * own the call (`authClient.signIn.social`), because sign-in and sign-up send
 * different requests; the button only shows it. Rendered only when the page
 * says the provider is configured (`isGoogleAuthConfigured()`).
 *
 * `ref` reaches the button, so a form can return focus to it after a refused
 * request (`useRefocusAfterPending`).
 */
export const GoogleSignInButton = React.forwardRef<HTMLButtonElement, GoogleSignInButtonProps>(
  ({ onClick, pending = false, disabled = false }, ref) => {
    const t = useTranslations('auth.google')
    return (
      <Button
        ref={ref}
        type="button"
        variant="outline"
        className="w-full"
        onClick={onClick}
        disabled={disabled || pending}
      >
        <GoogleMark />
        {pending ? t('redirecting') : t('continue')}
      </Button>
    )
  },
)
GoogleSignInButton.displayName = 'GoogleSignInButton'

/** The "or" rule between the email form's submit and Continue with Google. */
export function AuthMethodDivider() {
  const t = useTranslations('auth.google')
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <Body variant="muted">{t('divider')}</Body>
      <Separator className="flex-1" />
    </div>
  )
}

/**
 * Where Better Auth sends a failed Google attempt: the page it started on,
 * with its query, minus any earlier `error`. Better Auth appends
 * `error=<code>` rather than replacing it, and the query carries `returnUrl`
 * and, for an MCP client connecting (HON-1150), the signed authorization
 * query, which a retry needs.
 */
export function googleErrorCallbackURL(pathname: string, searchParams: URLSearchParams): string {
  const params = new URLSearchParams(searchParams.toString())
  params.delete('error')
  params.delete('error_description')
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}
