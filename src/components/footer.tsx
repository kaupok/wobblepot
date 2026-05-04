'use client'

import { useTranslations } from 'next-intl'
import { Body } from '@/components/ui/typography'
import { CookieSettingsTrigger } from '@/components/CookieSettingsTrigger'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from '@/lib/support'

export function Footer() {
  const year = new Date().getFullYear()
  const t = useTranslations('footer')
  return (
    <footer className="border-t px-4 py-6 pb-[calc(1.5rem+5rem+env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="mx-auto flex max-w-[1152px] flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <Body variant="muted">© {year} Wobblepot</Body>
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
          <a href={SUPPORT_EMAIL_HREF} className="text-muted-foreground text-sm hover:underline">
            {t('support')} <span className="sr-only">({SUPPORT_EMAIL})</span>
          </a>
          <CookieSettingsTrigger />
        </div>
      </div>
    </footer>
  )
}
