import { Body } from '@/components/ui/typography'
import { CookieSettingsTrigger } from '@/components/CookieSettingsTrigger'

export function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t px-4 py-6 pb-[calc(1.5rem+5rem+env(safe-area-inset-bottom,0px))] md:pb-6">
      <div className="mx-auto flex max-w-[1152px] flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <Body variant="muted">© {year} Honkadori</Body>
        <CookieSettingsTrigger />
      </div>
    </footer>
  )
}
