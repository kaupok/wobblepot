'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Session } from '@/lib/auth'

interface HeaderActionsProps {
  session: Session | null
}

export function HeaderActions({ session }: HeaderActionsProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            try {
              router.push('/')
              router.refresh()
            } catch (navError) {
              console.error('Navigation failed after sign-out:', navError)
            }
          },
          onError: (ctx) => {
            console.error('Sign-out failed:', ctx.error)
          },
        },
      })
    } catch (err) {
      console.error('Sign-out exception:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      {session ? (
        <Button onClick={handleSignOut} size="sm" variant="outline" disabled={isLoading}>
          {isLoading ? 'Signing out...' : 'Sign out'}
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Sign up</Link>
          </Button>
        </div>
      )}
      <ThemeToggle />
    </div>
  )
}
