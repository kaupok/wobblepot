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
import { AllergenPicker } from '@/components/household/AllergenPicker'
import type { Allergen } from '@/generated/prisma/enums'
import { FirstPlanStep } from './FirstPlanStep'
import { MAX_MEMBERS, MembersStep, type MemberDraft, type PortionType } from './MembersStep'

const TOTAL_STEPS = 4

type Step = 1 | 2 | 3 | 4

// How long a step ignores submits after it appears. Longer than a
// double-click: step 3's create button renders where step 2's Continue was,
// so a shorter guard lets the second click create the household before the
// allergens step is seen, and step 4 has no Back (HON-1082).
const TRANSITION_GUARD_MS = 500

interface OnboardingFlowProps {
  userName: string
}

/**
 * Sign-up to a first plan in four steps (docs/PROJECT_SPEC.md → New User
 * Setup): the household's name, who eats at its table, the allergens it
 * avoids, and the first plan. The household is created on leaving step 3,
 * with its allergens in the same request, because the plan needs both, so
 * step 4 has no Back. Nothing else is asked: other preferences are set on
 * `/household` afterwards (PROJECT_SPEC.md → Onboarding).
 */
export function OnboardingFlow({ userName }: OnboardingFlowProps) {
  const router = useRouter()
  const t = useTranslations('onboarding')
  const [currentStep, setCurrentStep] = useState<Step>(1)
  const [error, setError] = useState('')
  // Guard against race condition when moving to the next step, where the
  // Enter key event can inadvertently submit the form
  const [justTransitioned, setJustTransitioned] = useState(false)

  // Clear transition guard after TRANSITION_GUARD_MS, with cleanup to prevent memory leak
  useEffect(() => {
    if (justTransitioned) {
      const timeoutId = setTimeout(() => setJustTransitioned(false), TRANSITION_GUARD_MS)
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

  // Step 3: allergens to avoid. Kept here, so Back and forward keeps them.
  const [allergens, setAllergens] = useState<Allergen[]>([])

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
    // the next step's submit button appears
    setJustTransitioned(true)
    setCurrentStep(currentStep === 1 ? 2 : 3)
  }

  const handleBack = () => {
    setError('')
    setCurrentStep(currentStep === 3 ? 2 : 1)
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
          allergensToAvoid: allergens,
        }),
      })
    },
    onSuccess: (data) => {
      // No allergens and no count of them: they are health data (HON-1082).
      void track('onboarding:household_created', { household_id: data.id })
      // No refresh: the page would see the new membership and redirect to
      // Today before the first plan. Step 4 is the household's first screen.
      setCurrentStep(4)
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

    // Enter before the last form step means Continue (HON-836): step 1 has no
    // submit button, so Enter in the name field submits implicitly, and step
    // 2's submit button is Continue. Creating the household there would skip
    // the steps after it.
    if (currentStep < 3) {
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

  const title = {
    1: userName ? t('welcomeTitle', { name: userName }) : t('welcomeTitleNoName'),
    2: t('membersStepTitle'),
    3: t('allergensStepTitle'),
    4: t('planStepTitle'),
  }[currentStep]
  const description = {
    1: t('welcomeDescription'),
    2: t('membersStepDescription'),
    3: t('allergensStepDescription'),
    4: t('planStepDescription'),
  }[currentStep]

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
      {currentStep === 4 ? (
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
            ) : currentStep === 2 ? (
              <MembersStep
                userName={userName}
                members={members}
                defaultNameOf={defaultNameOf}
                onAdd={addMember}
                onRemove={removeMember}
                onNameChange={changeMemberName}
                disabled={isLoading}
              />
            ) : (
              <div className="flex flex-col gap-6">
                <AllergenPicker value={allergens} onChange={setAllergens} disabled={isLoading} />
                <Body variant="muted">{t('allergensHelper')}</Body>
              </div>
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
                {/* Keyed by step, so step 3's button is a new element and not
                    step 2's, still carrying the key press that moved here. */}
                <Button
                  key={currentStep}
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
