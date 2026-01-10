'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { Session } from '@/lib/auth'

interface MobileNavProps {
  session: Session | null
}

export function MobileNav({ session }: MobileNavProps) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <nav className="mt-6 flex flex-col gap-4 px-4">
          <Link
            href="/"
            className="hover:text-primary text-sm font-medium transition-colors"
            onClick={() => setOpen(false)}
          >
            Home
          </Link>
          <Link
            href="/about"
            className="hover:text-primary text-sm font-medium transition-colors"
            onClick={() => setOpen(false)}
          >
            About
          </Link>
          {session && (
            <>
              <Link
                href="/profile"
                className="hover:text-primary text-sm font-medium transition-colors"
                onClick={() => setOpen(false)}
              >
                Profile
              </Link>
              <Link
                href="/settings/household"
                className="hover:text-primary text-sm font-medium transition-colors"
                onClick={() => setOpen(false)}
              >
                Settings
              </Link>
            </>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
