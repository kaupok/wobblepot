'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
          setError('You are already a member of a household.')
        } else if (data.error === 'invite_invalid') {
          setError('This invite has expired or reached its maximum uses.')
        } else {
          setError(data.message || 'Failed to join household')
        }
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (status === 'already_member') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Already a member</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">You are already a member of &ldquo;{householdName}&rdquo;</Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Body>
            You can only be a member of one household at a time. To join a different household, you
            would need to leave your current one first.
          </Body>
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/">Go to dashboard</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (status === 'invalid') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <Heading variant="h2">Invite expired</Heading>
          </CardTitle>
          <CardDescription>
            <Body variant="muted">This invite is no longer valid</Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Body>
            This invite link has expired or reached its maximum number of uses. Please ask the
            household owner for a new invite.
          </Body>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Go to home</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <Heading variant="h2">{memberName ? `Join as ${memberName}` : 'Join household'}</Heading>
        </CardTitle>
        <CardDescription>
          <Body variant="muted">
            {memberName
              ? 'Claim your profile and join the household'
              : "You've been invited to join a household"}
          </Body>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <Body>
            You&apos;ve been invited to join <strong>{householdName}</strong>
            {memberName && (
              <>
                {' '}
                as <strong>{memberName}</strong>
              </>
            )}
            .
          </Body>
          <Body variant="muted">
            {memberName
              ? "Your profile has already been set up with preferences. Once you join, you'll be connected to this existing profile."
              : "Once you join, you'll be able to view and participate in meal planning for this household."}
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
            {isLoading ? 'Joining...' : memberName ? `Join as ${memberName}` : 'Join household'}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
