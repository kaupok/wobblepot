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
import { AttentionDot } from '@/components/attention-dot'
import { useThemeToggle } from '@/hooks/use-theme-toggle'
import type { Session } from '@/lib/auth'
import { ADMIN_LINKS } from '@/lib/admin-links'
import { getLoadedPostHog } from '@/lib/posthog-client-state'

interface HeaderActionsProps {
  session: Session | null
  hasHousehold: boolean
  /** True adds the admin pages to the menu, household or not (HON-1092). */
  isAdmin?: boolean
  /** Past meals still to mark; above 0, the icon and the row show a dot. */
  pastMealsToMark?: number
}

export function HeaderActions({
  session,
  hasHousehold,
  isAdmin = false,
  pastMealsToMark = 0,
}: HeaderActionsProps) {
  const router = useRouter()
  const t = useTranslations('nav.actions')
  const [isLoading, setIsLoading] = useState(false)
  const theme = useThemeToggle()
  // Past meals live behind a household, so without one there is no dot.
  const showsDot = hasHousehold && pastMealsToMark > 0

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            // Loads posthog-js only if this document initialised it, so a
            // user who declined analytics never fetches the chunk (HON-999).
            // Fire-and-forget: don't block the sign-out redirect on an
            // analytics chunk-load failure.
            getLoadedPostHog()
              .then((posthog) => posthog?.reset())
              .catch(() => {})
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
            {/* `pill`: the hover disc sits inside the header pill's curve. */}
            <Button variant="ghost" size="icon" shape="pill">
              <span className="relative flex">
                <User className="size-5" />
                {showsDot && <AttentionDot className="absolute -top-0.5 -right-0.5" />}
              </span>
              <span className="sr-only">
                {showsDot ? t('userMenuWithPastMeals') : t('userMenu')}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasHousehold && (
              <>
                <DropdownMenuItem asChild>
                  <Link href="/past-meals">
                    {t('pastMeals')}
                    {showsDot && (
                      <>
                        <AttentionDot />
                        <span className="sr-only">{t('pastMealsToMark')}</span>
                      </>
                    )}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/profile">{t('profile')}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {/* The admin pages need no household, so this group does not
                wait for one. */}
            {isAdmin && (
              <>
                {ADMIN_LINKS.map((link) => (
                  <DropdownMenuItem key={link.href} asChild>
                    <Link href={link.href}>{t(link.labelKey)}</Link>
                  </DropdownMenuItem>
                ))}
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
        <div className="flex items-center gap-1">
          {/* Signed out, inside the header pill: Sign in as a ghost so no
              control border sits inside the pill's, Sign up as the one filled
              pill, and the theme toggle a ghost disc like the account icon. */}
          <Button asChild variant="ghost" size="sm" shape="pill">
            <Link href="/sign-in">{t('signIn')}</Link>
          </Button>
          <Button asChild size="sm" shape="pill">
            <Link href="/sign-up">{t('signUp')}</Link>
          </Button>
          <ThemeToggle />
        </div>
      )}
    </div>
  )
}
