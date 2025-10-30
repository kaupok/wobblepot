'use client'

import { useState } from 'react'
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setIsLoading(true)

    try {
      await authClient.forgetPassword(
        {
          email,
          redirectTo: '/reset-password',
        },
        {
          onSuccess: () => {
            setSuccess(true)
          },
          onError: (ctx) => {
            const errorMessage = ctx.error?.message || 'Failed to send reset email'
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
            <Heading variant="h2">Forgot password</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">
              Enter your email address and we&apos;ll send you a link to reset your password
            </Body>
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="flex flex-col gap-4">
              {success ? (
                <div className="flex flex-col gap-2">
                  <Body variant="small" className="text-green-600" role="status">
                    If an account exists with this email, you will receive a password reset link
                    shortly. Check your console for the mock email.
                  </Body>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                      placeholder="you@example.com"
                    />
                  </div>
                  {error && (
                    <Body variant="small" className="text-destructive" role="alert">
                      {error}
                    </Body>
                  )}
                </>
              )}
            </div>
          </CardContent>
          <CardFooter className="pt-6">
            <div className="flex w-full flex-col gap-4">
              {!success && (
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Sending reset link...' : 'Send reset link'}
                </Button>
              )}
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
