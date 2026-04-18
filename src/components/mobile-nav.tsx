'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Menu } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Session } from '@/lib/auth'

interface MobileNavProps {
  session: Session | null
  hasHousehold: boolean
}

export function MobileNav({ session, hasHousehold }: MobileNavProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
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
          <SheetTitle>Account</SheetTitle>
        </SheetHeader>
        <nav aria-label="Account menu" className="mt-6 flex flex-col px-4">
          {session ? (
            <>
              <div className="flex flex-col gap-4">
                {hasHousehold && (
                  <Link
                    href="/profile"
                    className="hover:text-primary text-sm font-medium transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    Profile
                  </Link>
                )}
                <button
                  className="hover:text-primary text-left text-sm font-medium transition-colors"
                  onClick={handleSignOut}
                  disabled={isLoading}
                >
                  {isLoading ? 'Signing out...' : 'Sign out'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-4">
              <Link
                href="/sign-in"
                className="hover:text-primary text-sm font-medium transition-colors"
                onClick={() => setOpen(false)}
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="hover:text-primary text-sm font-medium transition-colors"
                onClick={() => setOpen(false)}
              >
                Sign up
              </Link>
            </div>
          )}
          <div className="pt-6">
            <ThemeToggle />
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
