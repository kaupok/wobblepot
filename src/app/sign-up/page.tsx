'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

export default function SignUpPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      await authClient.signUp.email(
        {
          email,
          password,
          name,
        },
        {
          onSuccess: () => {
            try {
              router.push('/profile')
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
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Sign up</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">Create a new account to get started</Body>
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isLoading}
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
                {isLoading ? 'Creating account...' : 'Sign up'}
              </Button>
              <Body variant="small" className="text-muted-foreground text-center">
                Already have an account?{' '}
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
