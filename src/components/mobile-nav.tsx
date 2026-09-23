'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Moon, Sun, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useThemeToggle } from '@/hooks/use-theme-toggle'
import type { Session } from '@/lib/auth'

interface MobileNavProps {
  session: Session | null
  hasHousehold: boolean
}

export function MobileNav({ session, hasHousehold }: MobileNavProps) {
  const router = useRouter()
  const t = useTranslations('nav.actions')
  const tSettings = useTranslations('nav.settings')
  const theme = useThemeToggle()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            // Fire-and-forget: don't let an analytics chunk-load failure
            // block the sign-out redirect.
            import('posthog-js').then(({ default: posthog }) => posthog.reset()).catch(() => {})
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

  const linkClass = 'hover:text-primary text-sm font-medium transition-colors'

  const themeRow = (
    <button
      type="button"
      className="hover:text-primary flex items-center gap-2 text-left text-sm font-medium transition-colors"
      onClick={theme.toggle}
    >
      {theme.isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {theme.label}
    </button>
  )

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="md:hidden">
          <User className="h-5 w-5" />
          <span className="sr-only">{t('userMenu')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{t('account')}</SheetTitle>
        </SheetHeader>
        {/* No top margin: SheetHeader's own padding is the gap (HON-775). */}
        <nav aria-label={t('accountMenu')} className="flex flex-col gap-4 px-4">
          {session ? (
            <>
              {hasHousehold && (
                <>
                  <Link href="/household" className={linkClass} onClick={() => setOpen(false)}>
                    {tSettings('household')}
                  </Link>
                  <Link href="/profile" className={linkClass} onClick={() => setOpen(false)}>
                    {t('profile')}
                  </Link>
                </>
              )}
              {themeRow}
              <button
                type="button"
                className="hover:text-primary text-left text-sm font-medium transition-colors"
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
