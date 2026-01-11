'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { getUserFriendlyError } from '@/lib/auth-errors'
import { getValidReturnUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnUrl = getValidReturnUrl(searchParams.get('returnUrl'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSlowRequest, setIsSlowRequest] = useState(false)

  useEffect(() => {
    // Check for password reset success
    const resetSuccess = searchParams.get('reset')
    if (resetSuccess === 'success') {
      setSuccessMessage(
        'Your password has been reset successfully. You can now sign in with your new password.',
      )
      // Clear the reset parameter while preserving other params (like returnUrl)
      const newParams = new URLSearchParams(searchParams.toString())
      newParams.delete('reset')
      const newUrl = newParams.toString() ? `/sign-in?${newParams.toString()}` : '/sign-in'
      router.replace(newUrl)
    }
  }, [searchParams, router])

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
      await authClient.signIn.email(
        {
          email,
          password,
        },
        {
          onSuccess: () => {
            try {
              router.push(returnUrl)
              router.refresh()
            } catch {
              setError('Authentication successful, but navigation failed. Please refresh the page.')
            }
          },
          onError: (ctx) => {
            const errorMessage = ctx.error?.message || 'Failed to sign in'
            setError(getUserFriendlyError(errorMessage))
          },
        },
      )
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
        <CardTitle>
          <Heading variant="h2">Sign in</Heading>
        </CardTitle>
        <CardDescription>
          <Body variant="muted">Sign in to your account</Body>
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-4">
            {successMessage && (
              <Body variant="small" className="text-green-600" role="status">
                {successMessage}
              </Body>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (successMessage) setSuccessMessage('')
                }}
                required
                disabled={isLoading}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-primary text-sm hover:underline"
                  tabIndex={-1}
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (successMessage) setSuccessMessage('')
                }}
                required
                disabled={isLoading}
                minLength={8}
              />
            </div>
            {error && (
              <Body variant="small" className="text-destructive" role="alert">
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
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
            <Body variant="small" className="text-muted-foreground text-center">
              Don&apos;t have an account?{' '}
              <Link
                href={
                  returnUrl !== '/profile'
                    ? `/sign-up?returnUrl=${encodeURIComponent(returnUrl)}`
                    : '/sign-up'
                }
                className="text-primary hover:underline"
              >
                Sign up
              </Link>
            </Body>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
