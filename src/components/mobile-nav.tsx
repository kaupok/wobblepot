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
}

export function MobileNav({ session }: MobileNavProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            try {
              setOpen(false)
              router.push('/')
              router.refresh()
            } catch (navError) {
              console.error('Navigation failed after sign-out:', navError)
            }
          },
          onError: (ctx) => {
            console.error('Sign-out failed:', ctx.error)
          },
        },
      })
    } catch (err) {
      console.error('Sign-out exception:', err)
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
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <nav className="mt-6 flex flex-col px-4">
          {session ? (
            <>
              {/* Daily operational views */}
              <div className="flex flex-col gap-4">
                <Link
                  href="/"
                  className="hover:text-primary text-sm font-medium transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Today
                </Link>
                <Link
                  href="/meal-plan"
                  className="hover:text-primary text-sm font-medium transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Meal plan
                </Link>
                <Link
                  href="/shopping"
                  className="hover:text-primary text-sm font-medium transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Pantry & shopping
                </Link>
              </div>

              {/* Settings/configuration views */}
              <div className="mt-6 flex flex-col gap-4 border-t pt-6">
                <Link
                  href="/recipes"
                  className="hover:text-primary text-sm font-medium transition-colors"
                  onClick={() => setOpen(false)}
                >
                  My recipes
                </Link>
                <Link
                  href="/household"
                  className="hover:text-primary text-sm font-medium transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Household
                </Link>
              </div>

              {/* Account */}
              <div className="mt-6 flex flex-col gap-4 border-t pt-6">
                <Link
                  href="/profile"
                  className="hover:text-primary text-sm font-medium transition-colors"
                  onClick={() => setOpen(false)}
                >
                  Profile
                </Link>
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
