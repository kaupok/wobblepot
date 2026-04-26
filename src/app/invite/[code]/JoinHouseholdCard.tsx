'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

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
          setError(data.message || t('errors.joinFailed'))
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
              ? t('valid.bodyMember', { householdName, memberName })
              : t('valid.bodyHouseholdOnly', { householdName })}
          </Body>
          <Body variant="muted">
            {memberName ? t('valid.subtextMember') : t('valid.subtextHouseholdOnly')}
          </Body>
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex w-full flex-col gap-4">
          {error && (
            <Body variant="small" className="text-destructive">
              {error}
            </Body>
          )}
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
