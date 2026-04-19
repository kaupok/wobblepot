'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { getUserFriendlyError } from '@/lib/auth-errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

export function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Extract token from URL query params
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      setToken(tokenParam)
    } else {
      setError('No reset token found. Please request a new password reset link.')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    // Validate password length
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters long')
      return
    }

    if (!token) {
      setError('No reset token found. Please request a new password reset link.')
      return
    }

    setIsLoading(true)

    try {
      await authClient.resetPassword(
        {
          newPassword,
          token,
        },
        {
          onSuccess: () => {
            // Redirect to sign-in page with success message
            router.push('/sign-in?reset=success')
          },
          onError: (ctx) => {
            const errorMessage = ctx.error?.message || 'Failed to reset password'
            setError(getUserFriendlyError(errorMessage))
          },
        },
      )
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Unable to connect. Please check your internet connection.'
      setError(getUserFriendlyError(errorMessage))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading variant="h4">Reset password</Heading>
        <Body variant="muted">Enter your new password below</Body>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isLoading || !token}
                minLength={12}
                placeholder="At least 12 characters"
                aria-describedby="password-hint"
              />
              <Body id="password-hint" variant="small" className="text-muted-foreground">
                Use at least 12 characters. Avoid passwords from past data breaches.
              </Body>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isLoading || !token}
                minLength={12}
                placeholder="Re-enter your password"
              />
            </div>
            {error && (
              <Body variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <div className="flex w-full flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading || !token}>
              {isLoading ? 'Resetting password...' : 'Reset password'}
            </Button>
            <Body variant="small" className="text-muted-foreground text-center">
              Remember your password?{' '}
              <Link href="/sign-in" className="text-primary hover:underline">
                Sign in
              </Link>
            </Body>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
