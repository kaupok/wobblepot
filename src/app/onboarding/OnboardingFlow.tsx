'use client'

import { useState, useEffect, useId, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { track } from '@/lib/analytics'
import { ApiError, apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { FieldError } from '@/components/FieldError'
import { FirstPlanStep } from './FirstPlanStep'
import { MAX_MEMBERS, MembersStep, type MemberDraft, type PortionType } from './MembersStep'

const TOTAL_STEPS = 3

type Step = 1 | 2 | 3

interface OnboardingFlowProps {
  userName: string
}

/**
 * Sign-up to a first plan in three steps (docs/PROJECT_SPEC.md → New User
 * Setup): the household's name, who eats at its table, and the first plan.
 * The household is created on leaving step 2, because the plan needs it, so
 * step 3 has no Back. Nothing else is asked: preferences are set on
 * `/household` afterwards (PROJECT_SPEC.md → Onboarding).
 */
export function OnboardingFlow({ userName }: OnboardingFlowProps) {
  const router = useRouter()
  const t = useTranslations('onboarding')
  const [currentStep, setCurrentStep] = useState<Step>(1)
  const [error, setError] = useState('')
  // Guard against race condition when transitioning from step 1 to 2
  // where Enter key event can inadvertently submit the form
  const [justTransitioned, setJustTransitioned] = useState(false)

  // Clear transition guard after 100ms, with cleanup to prevent memory leak
  useEffect(() => {
    if (justTransitioned) {
      const timeoutId = setTimeout(() => setJustTransitioned(false), 100)
      return () => clearTimeout(timeoutId)
    }
  }, [justTransitioned])

  // Move focus to the step title when the step changes, so a screen reader
  // announces the new step and a keyboard user starts at its top. Compared
  // against the previous step rather than a first-render flag: StrictMode runs
  // mount effects twice, and step 1 keeps its `autoFocus` on the name input.
  // The page goes back to its top first: on a phone, Continue under a long
  // member list leaves the next step's title above the fold, and focus alone
  // would scroll it to the title's scroll margin, not the top of the card.
  const stepId = useId()
  const titleRef = useRef<HTMLElement>(null)
  const prevStepRef = useRef(currentStep)
  useEffect(() => {
    if (prevStepRef.current === currentStep) return
    prevStepRef.current = currentStep
    window.scrollTo({ top: 0 })
    titleRef.current?.focus({ preventScroll: true })
  }, [currentStep])

  // Step 1: Household name (localized default; the user can edit it)
  const [name, setName] = useState(() => t('defaultHouseholdName', { name: userName }))

  // Step 2: everyone after the user, who is always the first adult
  const [members, setMembers] = useState<MemberDraft[]>([])
  const nextMemberId = useRef(0)

  const addMember = (portionType: PortionType) => {
    if (members.length + 1 >= MAX_MEMBERS) return
    const id = nextMemberId.current++
    setMembers((prev) => [...prev, { id, name: '', portionType }])
  }

  const removeMember = (id: number) => {
    setMembers((prev) => prev.filter((member) => member.id !== id))
  }

  const changeMemberName = (id: number, newName: string) => {
    setMembers((prev) =>
      prev.map((member) => (member.id === id ? { ...member, name: newName } : member)),
    )
  }

  // "Adult 2", "Child 1": numbered within the member's group, where the user
  // is adult 1. The placeholder shows it, and it is saved for an empty name.
  const defaultNameOf = (member: MemberDraft): string => {
    const sameType = members.filter((m) => m.portionType === member.portionType)
    const index = sameType.findIndex((m) => m.id === member.id) + 1
    const type = member.portionType === 'child' ? t('child') : t('adult')
    return t('defaultName', { type, index: member.portionType === 'adult' ? index + 1 : index })
  }

  const handleNext = () => {
    setError('')

    if (currentStep === 1 && !name.trim()) {
      setError(t('errors.nameRequired'))
      return
    }

    // Set transition guard to prevent race condition where Enter key
    // from "Continue" button inadvertently submits the form after
    // the submit button appears on step 2
    setJustTransitioned(true)
    setCurrentStep(2)
  }

  const handleBack = () => {
    setError('')
    setCurrentStep(1)
  }

  const submitRef = useRef<HTMLButtonElement>(null)
  const refocusSubmitRef = useRef(false)

  const createHousehold = useMutation({
    mutationFn: () => {
      // Adults first, as step 2 lists them.
      const ordered = [
        ...members.filter((m) => m.portionType === 'adult'),
        ...members.filter((m) => m.portionType === 'child'),
      ]
      return apiFetch<{ id: string }>('/api/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          members: ordered.map((member) => ({
            name: member.name.trim() || defaultNameOf(member),
            portionType: member.portionType,
          })),
        }),
      })
    },
    onSuccess: (data) => {
      void track('onboarding:household_created', { household_id: data.id })
      // No refresh: the page would see the new membership and redirect to
      // Today before the first plan. Step 3 is the household's first screen.
      setCurrentStep(3)
    },
    onError: (err) => {
      // `apiFetch` throws `ApiError` for every answer the route gave, so
      // anything else is the request never getting one.
      if (!(err instanceof ApiError)) {
        refocusSubmitRef.current = true
        setError(t('errors.network'))
        return
      }
      const body = err.body as { error?: unknown; message?: unknown }
      if (body.error === 'already_in_household') {
        router.push('/')
        router.refresh()
        return
      }
      // Deliberately not falling back to `body.error`: that field carries a
      // machine code or untranslated English (`Validation failed`,
      // `Failed to create household`), which would render verbatim to an
      // Estonian user. `JoinHouseholdCard` went further for the same reason
      // and now ignores the server string entirely (HON-697).
      //
      // `body.message` is not a translated channel either — it is simply
      // unreachable here today: `POST /api/households` sets it on the
      // `already_in_household` branch alone, which the early return above
      // intercepts. Every other failure carries `error` only, so this always
      // resolves to `t('errors.createFailed')`. If that route ever adds a
      // second `message`, translate it here rather than rendering it.
      refocusSubmitRef.current = true
      setError(
        typeof body.message === 'string' && body.message ? body.message : t('errors.createFailed'),
      )
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Ignore submissions triggered by race condition during step transition
    if (justTransitioned) {
      return
    }

    // Enter in the name field means Continue (HON-836): step 1 has no submit
    // button, so Enter there submits implicitly, and creating the household
    // here would skip the members step.
    if (currentStep === 1) {
      handleNext()
      return
    }

    setError('')
    createHousehold.mutate()
  }

  const isLoading = createHousehold.isPending

  // The control that submitted is disabled while the request is pending, which
  // drops focus to the body. `onError` still runs while pending, so it only
  // flags the refocus; the control takes focus once it is enabled again.
  useEffect(() => {
    if (isLoading || !refocusSubmitRef.current) return
    refocusSubmitRef.current = false
    submitRef.current?.focus()
  }, [isLoading])

  const title =
    currentStep === 1
      ? userName
        ? t('welcomeTitle', { name: userName })
        : t('welcomeTitleNoName')
      : currentStep === 2
        ? t('membersStepTitle')
        : t('planStepTitle')
  const description =
    currentStep === 1
      ? t('welcomeDescription')
      : currentStep === 2
        ? t('membersStepDescription')
        : t('planStepDescription')

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <Body variant="muted" id={stepId}>
              {t('step', { current: currentStep, total: TOTAL_STEPS })}
            </Body>
            {/* The same count as the line above, drawn: decoration only. */}
            <div className="flex gap-1.5" aria-hidden="true">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full',
                    i < currentStep ? 'bg-primary' : 'bg-muted',
                  )}
                />
              ))}
            </div>
          </div>
          <div className="mt-2">
            <Heading ref={titleRef} as="h1" variant="h4" tabIndex={-1} aria-describedby={stepId}>
              {title}
            </Heading>
          </div>
          <Body variant="muted">{description}</Body>
        </div>
      </CardHeader>
      {currentStep === 3 ? (
        <FirstPlanStep />
      ) : (
        /* noValidate: Enter on step 1 submits, and the browser would block that
           with its own untranslated bubble for the `required` name instead of
           letting `handleNext` show the app's error, as Continue does (HON-836). */
        <form onSubmit={handleSubmit} noValidate>
          <CardContent>
            {currentStep === 1 ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">{t('nameLabel')}</Label>
                <Input
                  id="name"
                  name="householdName"
                  type="text"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                  autoFocus
                />
              </div>
            ) : (
              <MembersStep
                userName={userName}
                members={members}
                defaultNameOf={defaultNameOf}
                onAdd={addMember}
                onRemove={removeMember}
                onNameChange={changeMemberName}
                disabled={isLoading}
              />
            )}
            {error && (
              <div className="mt-4">
                <FieldError>{error}</FieldError>
              </div>
            )}
          </CardContent>
          {/* The card is the form, so its action is the form's width
              (docs/DESIGN.md → "Buttons are as wide as their label"). */}
          <CardFooter className="flex gap-2 pt-6">
            {currentStep === 1 ? (
              <Button type="button" size="lg" className="w-full" onClick={handleNext}>
                {t('continue')}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={handleBack}
                  disabled={isLoading}
                >
                  {t('back')}
                </Button>
                <Button
                  ref={submitRef}
                  type="submit"
                  size="lg"
                  className="flex-1"
                  disabled={isLoading}
                >
                  {isLoading ? t('saving') : t('continue')}
                </Button>
              </>
            )}
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
