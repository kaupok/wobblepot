'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { getUserFriendlyError } from '@/lib/auth-errors'
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

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // Get token from URL query parameter
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      setToken(tokenParam)
    } else {
      setError('Invalid or missing reset token. Please request a new password reset.')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please try again.')
      return
    }

    // Validate password length
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset.')
      return
    }

    setIsLoading(true)

    try {
      await authClient.resetPassword(
        {
          newPassword: password,
          token,
        },
        {
          onSuccess: () => {
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
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Reset password</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">Enter your new password</Body>
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={isLoading || !token}
                  minLength={8}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={isLoading || !token}
                  minLength={8}
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
          <CardFooter>
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
    </div>
  )
}
