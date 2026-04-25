'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { getUserFriendlyError } from '@/lib/auth-errors'
import { getValidReturnUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

interface SignUpFormProps {
  inviteRequired: boolean
  privateBetaBanner: string
  inviteCodeLabel: string
  inviteCodeHint: string
}

export function SignUpForm({
  inviteRequired,
  privateBetaBanner,
  inviteCodeLabel,
  inviteCodeHint,
}: SignUpFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = getValidReturnUrl(searchParams.get('returnUrl'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSlowRequest, setIsSlowRequest] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    setIsSlowRequest(false)

    // Start timeout detection (10 seconds)
    const timeoutId = setTimeout(() => {
      setIsSlowRequest(true)
    }, 10000)

    try {
      // Better Auth's email signup endpoint forwards unknown body fields to
      // the request-level `hooks.before` middleware (see src/lib/auth.ts).
      // The invite code is consumed there; it must NOT be persisted on the
      // user row, so it is intentionally not in `additionalFields`.
      const payload: Record<string, unknown> = { email, password, name }
      if (inviteRequired) {
        payload.inviteCode = inviteCode
      }
      await authClient.signUp.email(payload as Parameters<typeof authClient.signUp.email>[0], {
        onSuccess: () => {
          try {
            router.push(returnUrl)
            router.refresh()
          } catch {
            setError(
              'Account created successfully, but navigation failed. Please refresh the page.',
            )
          }
        },
        onError: (ctx) => {
          const errorMessage = ctx.error?.message || 'Failed to sign up'
          setError(getUserFriendlyError(errorMessage))
        },
      })
    } catch (err) {
      // Handle exceptions thrown by authClient (e.g., network errors when offline)
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Unable to connect. Please check your internet connection.'
      setError(getUserFriendlyError(errorMessage))
    } finally {
      clearTimeout(timeoutId)
      setIsLoading(false)
      setIsSlowRequest(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading variant="h4">Sign up</Heading>
        <Body variant="muted">Create a new account to get started</Body>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-4">
            {inviteRequired && (
              <div
                className="border-primary/30 bg-primary/5 rounded-md border px-3 py-2"
                role="note"
                aria-label="Private beta notice"
              >
                <Body variant="small">{privateBetaBanner}</Body>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isLoading}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : undefined}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                minLength={12}
                aria-invalid={!!error}
                aria-describedby={error ? 'form-error' : 'password-hint'}
              />
              <Body id="password-hint" variant="small" className="text-muted-foreground">
                Use at least 12 characters. Avoid passwords from past data breaches.
              </Body>
            </div>
            {inviteRequired && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="inviteCode">{inviteCodeLabel}</Label>
                <Input
                  id="inviteCode"
                  name="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  autoComplete="off"
                  disabled={isLoading}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'form-error' : 'invite-code-hint'}
                />
                <Body id="invite-code-hint" variant="small" className="text-muted-foreground">
                  {inviteCodeHint}
                </Body>
              </div>
            )}
            {error && (
              <Body id="form-error" variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
            {isSlowRequest && !error && (
              <Body variant="small" className="text-muted-foreground">
                This is taking longer than expected. Please wait...
              </Body>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Sign up'}
            </Button>
            <Body variant="small" className="text-muted-foreground text-center">
              Already have an account?{' '}
              <Link
                href={
                  returnUrl !== '/'
                    ? `/sign-in?returnUrl=${encodeURIComponent(returnUrl)}`
                    : '/sign-in'
                }
                className="text-primary hover:underline"
              >
                Sign in
              </Link>
            </Body>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
