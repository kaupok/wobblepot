'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export function SignOutButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push('/')
            router.refresh()
          },
        },
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button onClick={handleSignOut} variant="outline" disabled={isLoading} className="w-full">
      {isLoading ? 'Signing out...' : 'Sign Out'}
    </Button>
  )
}
