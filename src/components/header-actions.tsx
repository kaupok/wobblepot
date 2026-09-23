'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Moon, Sun, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
import { useThemeToggle } from '@/hooks/use-theme-toggle'
import type { Session } from '@/lib/auth'

interface HeaderActionsProps {
  session: Session | null
  hasHousehold: boolean
}

export function HeaderActions({ session, hasHousehold }: HeaderActionsProps) {
  const router = useRouter()
  const t = useTranslations('nav.actions')
  const [isLoading, setIsLoading] = useState(false)
  const theme = useThemeToggle()

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            // Dynamic import so posthog-js stays out of the main bundle.
            // Fire-and-forget: don't block the sign-out redirect on an
            // analytics chunk-load failure.
            import('posthog-js').then(({ default: posthog }) => posthog.reset()).catch(() => {})
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
            <Button variant="ghost" size="icon">
              <User className="h-5 w-5" />
              <span className="sr-only">{t('userMenu')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasHousehold && (
              <>
                <DropdownMenuItem asChild>
                  <Link href="/profile">{t('profile')}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleSignOut} disabled={isLoading}>
              {isLoading ? t('signingOut') : t('signOut')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={theme.toggle}>
              {theme.isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme.label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/sign-in">{t('signIn')}</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">{t('signUp')}</Link>
          </Button>
          <ThemeToggle />
        </div>
      )}
    </div>
  )
}
