'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
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

/**
 * Maps API error messages to user-friendly messages
 */
function getUserFriendlyError(message: string): string {
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('invalid') && lowerMessage.includes('credentials')) {
    return 'The email or password you entered is incorrect. Please try again.'
  }
  if (lowerMessage.includes('user not found') || lowerMessage.includes('no user')) {
    return 'No account found with this email address.'
  }
  if (lowerMessage.includes('password') && lowerMessage.includes('incorrect')) {
    return 'The password you entered is incorrect. Please try again.'
  }
  if (lowerMessage.includes('too many')) {
    return 'Too many sign-in attempts. Please try again later.'
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'Unable to connect to the server. Please check your internet connection.'
  }

  // Return the original message if no mapping found
  return message
}

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await authClient.signIn.email(
        {
          email,
          password,
        },
        {
          onSuccess: () => {
            router.push('/profile')
            router.refresh()
          },
          onError: (ctx) => {
            const errorMessage = ctx.error.message || 'Failed to sign in'
            setError(getUserFriendlyError(errorMessage))
          },
        },
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Sign In</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">Sign in to your account</Body>
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
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
                  minLength={8}
                />
              </div>
              {error && (
                <Body variant="small" className="text-destructive">
                  {error}
                </Body>
              )}
            </div>
          </CardContent>
          <CardFooter className="pt-6">
            <div className="flex w-full flex-col gap-4">
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
              <Body variant="small" className="text-muted-foreground text-center">
                Don&apos;t have an account?{' '}
                <Link href="/sign-up" className="text-primary hover:underline">
                  Sign up
                </Link>
              </Body>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
