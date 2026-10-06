'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Moon, Sun, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { AttentionDot } from '@/components/attention-dot'
import { useThemeToggle } from '@/hooks/use-theme-toggle'
import type { Session } from '@/lib/auth'
import { ADMIN_LINKS } from '@/lib/admin-links'
import { getLoadedPostHog } from '@/lib/posthog-client-state'

interface MobileNavProps {
  session: Session | null
  hasHousehold: boolean
  /** True adds the admin pages to the sheet, household or not (HON-1092). */
  isAdmin?: boolean
  /** Past meals still to mark; above 0, the icon and the row show a dot. */
  pastMealsToMark?: number
}

export function MobileNav({
  session,
  hasHousehold,
  isAdmin = false,
  pastMealsToMark = 0,
}: MobileNavProps) {
  const router = useRouter()
  const t = useTranslations('nav.actions')
  const tSettings = useTranslations('nav.settings')
  const theme = useThemeToggle()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  // Past meals live behind a household, so without one there is no dot.
  const showsDot = Boolean(session) && hasHousehold && pastMealsToMark > 0

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            // Fire-and-forget: don't let an analytics chunk-load failure
            // block the sign-out redirect.
            getLoadedPostHog()
              .then((posthog) => posthog?.reset())
              .catch(() => {})
            setOpen(false)
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

  // Every row clears the 44px touch floor (docs/DESIGN.md → Spacing, HON-783);
  // the rows sit flush as a list, so the target is the whole row, not the text.
  const linkClass =
    'hover:text-primary flex min-h-touch items-center gap-2 text-sm font-medium transition-colors'

  const themeRow = (
    <button
      type="button"
      className="hover:text-primary min-h-touch flex items-center gap-2 text-left text-sm font-medium transition-colors"
      onClick={theme.toggle}
    >
      {theme.isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {theme.label}
    </button>
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {/* `icon` for the full touch target, `pill` so its hover disc sits
            inside the header pill's curve. */}
        <Button variant="ghost" size="icon" shape="pill" className="md:hidden">
          {/* The dot sits inside the icon's box, so the 48px disc the pill
              draws in to when scrolled never clips it. */}
          <span className="relative flex">
            <User className="size-5" />
            {showsDot && <AttentionDot className="absolute -top-0.5 -right-0.5" />}
          </span>
          <span className="sr-only">{showsDot ? t('userMenuWithPastMeals') : t('userMenu')}</span>
        </Button>
      </SheetTrigger>
      {/* `SheetContent`'s close button is a 32px `icon-sm` target at
          `top-2 right-2` (HON-810). This sheet is the phone's account menu,
          so raise it to the 44px touch floor like every row below (HON-783). */}
      <SheetContent side="right" className="[&>[data-slot=sheet-close]]:size-touch">
        <SheetHeader>
          <SheetTitle>{t('account')}</SheetTitle>
        </SheetHeader>
        {/* No top margin: SheetHeader's own padding is the gap (HON-775). */}
        <nav aria-label={t('accountMenu')} className="flex flex-col px-4">
          {session ? (
            <>
              {hasHousehold && (
                <>
                  <Link href="/past-meals" className={linkClass} onClick={() => setOpen(false)}>
                    {t('pastMeals')}
                    {showsDot && (
                      <>
                        <AttentionDot />
                        <span className="sr-only">{t('pastMealsToMark')}</span>
                      </>
                    )}
                  </Link>
                  <Link href="/household" className={linkClass} onClick={() => setOpen(false)}>
                    {tSettings('household')}
                  </Link>
                  <Link href="/profile" className={linkClass} onClick={() => setOpen(false)}>
                    {t('profile')}
                  </Link>
                </>
              )}
              {isAdmin &&
                ADMIN_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={linkClass}
                    onClick={() => setOpen(false)}
                  >
                    {t(link.labelKey)}
                  </Link>
                ))}
              {themeRow}
              <button
                type="button"
                className="hover:text-primary min-h-touch flex items-center text-left text-sm font-medium transition-colors"
                onClick={handleSignOut}
                disabled={isLoading}
              >
                {isLoading ? t('signingOut') : t('signOut')}
              </button>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={linkClass} onClick={() => setOpen(false)}>
                {t('signIn')}
              </Link>
              <Link href="/sign-up" className={linkClass} onClick={() => setOpen(false)}>
                {t('signUp')}
              </Link>
              {themeRow}
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
