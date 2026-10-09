'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FieldError } from '@/components/FieldError'
import { ApiError, apiFetch } from '@/lib/api'
import { householdInvitePath } from '@/lib/household-invite-link'

/** The route's error body: `error` is a machine-readable code, `message` English prose. */
interface JoinErrorBody {
  error?: unknown
  message?: unknown
}

/** The household the invitee is in now, for the already-member states (HON-1133). */
interface CurrentHousehold {
  name: string
  /** The invitee owns it and is its only account holder, so leaving deletes it. */
  deletesHousehold: boolean
  /** Other members with an account. Only read by `cannot_leave`. */
  otherAccountCount: number
}

interface JoinHouseholdCardProps {
  /**
   * `signed_out`: a valid invite seen by a visitor with no session (HON-1131).
   * `leave_and_join`: a valid invite seen by a member of another household who
   * can leave it. `cannot_leave`: the same, but they own a household that has
   * other account holders. `already_member`: no move is on offer, because the
   * invite is into their own household or could not be read (HON-1133).
   */
  status: 'valid' | 'signed_out' | 'invalid' | 'already_member' | 'leave_and_join' | 'cannot_leave'
  /** The invite's household; for `already_member`, the invitee's own. */
  householdName: string
  memberName: string | null
  code: string
  /** Required by `leave_and_join` and `cannot_leave`. */
  currentHousehold?: CurrentHousehold
}

export function JoinHouseholdCard({
  status,
  householdName,
  memberName,
  code,
  currentHousehold,
}: JoinHouseholdCardProps) {
  const router = useRouter()
  const t = useTranslations('auth.invite')
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const leaveTriggerRef = useRef<HTMLButtonElement>(null)

  const join = useMutation({
    mutationFn: ({ leaveCurrent }: { leaveCurrent: boolean }) =>
      apiFetch<void>(`/api/invites/${code}/join`, {
        method: 'POST',
        ...(leaveCurrent && {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leaveCurrent: true }),
        }),
      }),
    onSuccess: () => {
      router.push('/')
      router.refresh()
    },
    onError: (err) => {
      // The leave-and-join confirm closes so the error shows on the card;
      // `onCloseAutoFocus` returns focus to its trigger.
      setConfirmOpen(false)
      if (!(err instanceof ApiError)) {
        setError(t('errors.generic'))
        return
      }
      const data = err.body as JoinErrorBody
      if (data.error === 'already_in_household') {
        setError(t('errors.alreadyInHousehold'))
      } else if (data.error === 'owner_has_other_accounts') {
        setError(t('errors.ownerHasOtherAccounts'))
      } else if (data.error === 'invite_invalid') {
        setError(t('errors.inviteInvalid'))
      } else {
        // Deliberately not falling back to `data.message` / `data.error`:
        // both carry untranslated English (`Invite code not found.`,
        // `Failed to join household`), which would render verbatim inside an
        // otherwise Estonian screen (HON-697). Every code without an explicit
        // branch renders a translated string; the server prose is kept as a
        // console breadcrumb only, and the route still returns the distinct
        // `error` code so logs and PostHog tell the cases apart.
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
    },
  })

  const isLoading = join.isPending

  const handleJoin = () => {
    setError('')
    join.mutate({ leaveCurrent: false })
  }

  if (status === 'leave_and_join' && currentHousehold) {
    // A successful move stays "joining" until the redirect lands: the old
    // household may already be gone.
    const isMoving = join.isPending || join.isSuccess
    const consequence = currentHousehold.deletesHousehold
      ? t('leaveAndJoin.bodyOwner', { currentHouseholdName: currentHousehold.name })
      : t('leaveAndJoin.bodyMember', { currentHouseholdName: currentHousehold.name })
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading as="h1" variant="h4">
            {t('leaveAndJoin.title', { householdName })}
          </Heading>
          <Body variant="muted">
            {t('leaveAndJoin.description', { currentHouseholdName: currentHousehold.name })}
          </Body>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <InviteLine householdName={householdName} memberName={memberName} />
            <Body>{consequence}</Body>
            {currentHousehold.deletesHousehold && (
              <Body variant="muted">{t('leaveAndJoin.exportNote')}</Body>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex w-full flex-col gap-4">
            {error && <FieldError>{error}</FieldError>}
            <Button
              ref={leaveTriggerRef}
              variant={currentHousehold.deletesHousehold ? 'destructive' : 'default'}
              onClick={() => {
                setError('')
                setConfirmOpen(true)
              }}
              className="w-full"
            >
              {t('leaveAndJoin.action')}
            </Button>
          </div>
        </CardFooter>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!isMoving) setConfirmOpen(open)
          }}
          title={t('leaveAndJoin.confirmTitle')}
          description={consequence}
          confirmLabel={t('leaveAndJoin.action')}
          loadingLabel={t('leaveAndJoin.joining')}
          variant={currentHousehold.deletesHousehold ? 'destructive' : 'default'}
          isLoading={isMoving}
          onConfirm={() => join.mutate({ leaveCurrent: true })}
          onCloseAutoFocus={(event) => {
            // Opened from state, so there is no trigger for Radix to return
            // focus to (CLAUDE.md → Focus management).
            event.preventDefault()
            leaveTriggerRef.current?.focus()
          }}
        />
      </Card>
    )
  }

  if (status === 'cannot_leave' && currentHousehold) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading as="h1" variant="h4">
            {t('alreadyMember.title')}
          </Heading>
          <Body variant="muted">
            {t('alreadyMember.description', { householdName: currentHousehold.name })}
          </Body>
        </CardHeader>
        <CardContent>
          <Body>
            {t('leaveAndJoin.cannotLeaveBody', {
              currentHouseholdName: currentHousehold.name,
              count: currentHousehold.otherAccountCount,
            })}
          </Body>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href="/household">{t('leaveAndJoin.cannotLeaveAction')}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (status === 'already_member' || status === 'leave_and_join' || status === 'cannot_leave') {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <Heading as="h1" variant="h4">
            {t('alreadyMember.title')}
          </Heading>
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
          <Heading as="h1" variant="h4">
            {t('invalid.title')}
          </Heading>
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

  if (status === 'signed_out') {
    // The invitee has no account yet. The household invite admits them
    // without a sign-up code, so Create account comes first; Sign in returns
    // here once signed in, to the signed-in card.
    const signInHref = `/sign-in?returnUrl=${encodeURIComponent(householdInvitePath(code))}`
    return (
      <Card className="w-full max-w-md">
        <InviteDetails
          householdName={householdName}
          memberName={memberName}
          subtext={t('signedOut.subtext')}
        />
        <CardFooter>
          <div className="flex w-full flex-col gap-2">
            <Button asChild className="w-full">
              <Link href={`/sign-up?invite=${encodeURIComponent(code)}`}>
                {t('signedOut.createAccount')}
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={signInHref}>{t('signedOut.signIn')}</Link>
            </Button>
          </div>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <InviteDetails
        householdName={householdName}
        memberName={memberName}
        subtext={memberName ? t('valid.subtextMember') : t('valid.subtextHouseholdOnly')}
      />
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

/**
 * The header and body of a valid invite: the same two names, whether the
 * visitor is signed in or not (HON-1131). Only the subtext differs.
 */
function InviteDetails({
  householdName,
  memberName,
  subtext,
}: {
  householdName: string
  memberName: string | null
  subtext: string
}) {
  const t = useTranslations('auth.invite')
  return (
    <>
      <CardHeader>
        <Heading as="h1" variant="h4">
          {memberName ? t('valid.titleNamed', { memberName }) : t('valid.title')}
        </Heading>
        <Body variant="muted">
          {memberName ? t('valid.descriptionNamed') : t('valid.description')}
        </Body>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <InviteLine householdName={householdName} memberName={memberName} />
          <Body variant="muted">{subtext}</Body>
        </div>
      </CardContent>
    </>
  )
}

/** "You've been invited to join …", naming the member profile when there is one. */
function InviteLine({
  householdName,
  memberName,
}: {
  householdName: string
  memberName: string | null
}) {
  const t = useTranslations('auth.invite')
  return (
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
  )
}
