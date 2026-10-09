'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/components/FieldError'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { MAX_ACCOUNT_NAME_LENGTH } from '@/lib/account-name'

/**
 * Edits the account name (`User.name`). A household member with a linked
 * account and no own name shows this name on `/household`, so the member row
 * is not written here (HON-1129).
 */
export function ProfileNameForm({ initialName }: { initialName: string }) {
  const router = useRouter()
  const t = useTranslations('profile.name')
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { ref: submitRef, requestRefocus } = useRefocusAfterPending(isLoading)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('required'))
      return
    }
    if (trimmed.length > MAX_ACCOUNT_NAME_LENGTH) {
      setError(t('tooLong'))
      return
    }

    setIsLoading(true)
    let saved = false

    try {
      const { error: serverError } = await authClient.updateUser({ name: trimmed })
      if (serverError) {
        // The server string is English and for logs; the user sees catalog copy.
        console.error('[profile-name] update failed', serverError.message)
      } else {
        saved = true
      }
    } catch (err) {
      console.error('[profile-name] update failed', err)
    }

    if (saved) {
      setName(trimmed)
      toast.success(t('saved'))
      // Re-render the server page so it reads the new name from the session.
      router.refresh()
    } else {
      setError(t('saveFailed'))
      // The button lost focus when the form was disabled; give it back.
      requestRefocus()
    }
    setIsLoading(false)
  }

  return (
    // `noValidate`: an empty name shows catalog copy, not the browser's bubble.
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="accountName">{t('label')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Input
              id="accountName"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={MAX_ACCOUNT_NAME_LENGTH}
              disabled={isLoading}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'account-name-error' : undefined}
            />
          </div>
          <Button ref={submitRef} type="submit" disabled={isLoading}>
            {isLoading ? t('saving') : t('save')}
          </Button>
        </div>
        {error && <FieldError id="account-name-error">{error}</FieldError>}
      </div>
    </form>
  )
}
