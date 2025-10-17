import { H4 } from '@/components/ui/typography'
import { ThemeToggle } from '@/components/theme-toggle'

export function Header() {
  return (
    <header className="border-b">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <H4>Honkadori</H4>
        <ThemeToggle />
      </div>
    </header>
  )
}
