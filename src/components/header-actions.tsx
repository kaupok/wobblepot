'use client'

import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Moon, Sun, User } from 'lucide-react'
import { useTheme } from 'next-themes'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Session } from '@/lib/auth'

const emptySubscribe = () => () => {}

interface HeaderActionsProps {
  session: Session | null
  hasHousehold: boolean
}

export function HeaderActions({ session, hasHousehold }: HeaderActionsProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push('/')
            router.refresh()
          },
        },
      })
    } catch {
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="hidden items-center gap-4 md:flex">
      {session ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <User className="h-5 w-5" />
              <span className="sr-only">User menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasHousehold && (
              <>
                <DropdownMenuItem asChild>
                  <Link href="/profile">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleSignOut} disabled={isLoading}>
              {isLoading ? 'Signing out...' : 'Sign out'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
              {mounted && resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              {mounted ? (resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode') : 'Toggle theme'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Sign up</Link>
          </Button>
          <ThemeToggle />
        </div>
      )}
    </div>
  )
}
