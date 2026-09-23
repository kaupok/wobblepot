'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { FieldError } from '@/components/FieldError'

interface JoinHouseholdCardProps {
  status: 'valid' | 'invalid' | 'already_member'
  householdName: string
  memberName: string | null
  code: string
}

export function JoinHouseholdCard({
  status,
  householdName,
  memberName,
  code,
}: JoinHouseholdCardProps) {
  const router = useRouter()
  const t = useTranslations('auth.invite')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleJoin = async () => {
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch(`/api/invites/${code}/join`, {
        method: 'POST',
      })

      if (!response.ok) {
        const data = await response.json()
        if (data.error === 'already_in_household') {
          setError(t('errors.alreadyInHousehold'))
        } else if (data.error === 'invite_invalid') {
          setError(t('errors.inviteInvalid'))
        } else {
          // Deliberately not falling back to `data.message` / `data.error`:
          // both carry untranslated English (`Invite code not found.`,
          // `Failed to join household`), which would render verbatim inside an
          // otherwise Estonian screen (HON-697). Every code without an explicit
          // branch renders a translated string; the server prose is kept as a
          // console breadcrumb only, and the route still returns the distinct
          // `error` code so logs and Sentry tell the cases apart.
          console.error('[invite-join] request failed', {
            error: data.error,
            message: data.message,
          })
          // `invite_not_found` reaches this card only when the invite was
          // consumed, revoked or cascade-deleted *between* render and click —
          // `page.tsx` calls `notFound()` for a code that never resolved, so
          // the button does not exist for one. That is the same situation the
          // route maps to `invite_invalid` for the loser of a concurrent claim
          // (see `InviteNoLongerClaimableError` there), and it is in fact the
          // commoner half of it: the 404 is what a click after another user's
          // claim already committed produces. Same copy, no new strings — and
          // it tells the user to ask for a new invite, which the generic
          // fallback does not.
          setError(
            data.error === 'invite_not_found' ? t('errors.inviteInvalid') : t('errors.joinFailed'),
          )
        }
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError(t('errors.generic'))
    } finally {
      setIsLoading(false)
    }
  }

  if (status === 'already_member') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading variant="h4">{t('alreadyMember.title')}</Heading>
          <Body variant="muted">{t('alreadyMember.description', { householdName })}</Body>
        </CardHeader>
        <CardContent>
          <Body>{t('alreadyMember.body')}</Body>
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/">{t('alreadyMember.action')}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (status === 'invalid') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading variant="h4">{t('invalid.title')}</Heading>
          <Body variant="muted">{t('invalid.description')}</Body>
        </CardHeader>
        <CardContent>
          <Body>{t('invalid.body')}</Body>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">{t('invalid.action')}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Heading variant="h4">
          {memberName ? t('valid.titleNamed', { memberName }) : t('valid.title')}
        </Heading>
        <Body variant="muted">
          {memberName ? t('valid.descriptionNamed') : t('valid.description')}
        </Body>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <Body>
            {memberName
              ? t.rich('valid.bodyMember', {
                  householdName,
                  memberName,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })
              : t.rich('valid.bodyHouseholdOnly', {
                  householdName,
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
          </Body>
          <Body variant="muted">
            {memberName ? t('valid.subtextMember') : t('valid.subtextHouseholdOnly')}
          </Body>
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex w-full flex-col gap-4">
          {error && <FieldError>{error}</FieldError>}
          <Button onClick={handleJoin} disabled={isLoading} className="w-full">
            {isLoading
              ? t('valid.joining')
              : memberName
                ? t('valid.actionNamed', { memberName })
                : t('valid.action')}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
