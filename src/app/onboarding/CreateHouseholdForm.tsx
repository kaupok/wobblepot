'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Minus, Plus } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from '@/components/ui/number-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'
import { track } from '@/lib/analytics'

const TOTAL_STEPS = 2

interface CreateHouseholdFormProps {
  userName: string
}

type PortionType = 'adult' | 'child'

interface MemberRow {
  name: string
  portionType: PortionType
}

export function CreateHouseholdForm({ userName }: CreateHouseholdFormProps) {
  const router = useRouter()
  const t = useTranslations('onboarding')
  const [currentStep, setCurrentStep] = useState(1)
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

  // Step 1: Household name (localized default; the user can edit it)
  const [name, setName] = useState(() => t('defaultHouseholdName', { name: userName }))

  // Step 2: Members (size-first approach from #348)
  const [householdSize, setHouseholdSize] = useState(1)
  const [memberRows, setMemberRows] = useState<MemberRow[]>([
    { name: userName, portionType: 'adult' },
  ])

  const handleHouseholdSizeChange = (newSize: number) => {
    const clampedSize = Math.max(1, Math.min(10, newSize))
    setHouseholdSize(clampedSize)

    setMemberRows((prev) => {
      if (clampedSize > prev.length) {
        // Add new rows with defaults
        const newRows = Array.from({ length: clampedSize - prev.length }, () => ({
          name: '',
          portionType: 'adult' as PortionType,
        }))
        return [...prev, ...newRows]
      }
      // Trim rows (keep first N, never remove row 0)
      return prev.slice(0, clampedSize)
    })
  }

  const handleMemberNameChange = (index: number, newName: string) => {
    setMemberRows((prev) => prev.map((row, i) => (i === index ? { ...row, name: newName } : row)))
  }

  const handlePortionTypeChange = (index: number, portionType: PortionType) => {
    setMemberRows((prev) => prev.map((row, i) => (i === index ? { ...row, portionType } : row)))
  }

  const generateDefaultName = (index: number, row: MemberRow): string => {
    if (row.name.trim()) return row.name.trim()

    // Count how many of this type come before this index (for numbering)
    let typeCount = 0
    for (let i = 0; i <= index; i++) {
      if (memberRows[i]?.portionType === row.portionType) {
        typeCount++
      }
    }

    const typeLabel = row.portionType === 'child' ? t('child') : t('adult')
    return t('defaultName', { type: typeLabel, index: typeCount })
  }

  const handleNext = () => {
    setError('')

    if (currentStep === 1 && !name.trim()) {
      setError(t('errors.nameRequired'))
      return
    }

    if (currentStep < TOTAL_STEPS) {
      // Set transition guard to prevent race condition where Enter key
      // from "Continue" button inadvertently submits the form after
      // the submit button appears on step 2
      setJustTransitioned(true)
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    setError('')
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const createHousehold = useMutation({
    mutationFn: async () => {
      let response: Response
      try {
        response = await fetch('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            members: memberRows.slice(1).map((row, index) => ({
              name: generateDefaultName(index + 1, row),
              portionType: row.portionType,
            })),
          }),
        })
      } catch {
        throw new Error(t('errors.network'))
      }

      const data = await response.json()

      if (!response.ok) {
        if (data.error === 'already_in_household') {
          router.push('/')
          router.refresh()
          return
        }
        throw new Error(data.message || data.error || t('errors.createFailed'))
      }

      return data
    },
    onSuccess: (data) => {
      if (data) {
        void track('onboarding:household_created', { household_id: data.id })
        toast.success(t('createdToast'))
        router.push('/')
        router.refresh()
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Ignore submissions triggered by race condition during step transition
    if (justTransitioned) {
      return
    }

    setError('')
    createHousehold.mutate()
  }

  const isLoading = createHousehold.isPending

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{t('nameLabel')}</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isLoading}
                maxLength={100}
                autoFocus
              />
            </div>
          </div>
        )

      case 2:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="householdSize">{t('householdSizeLabel')}</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => handleHouseholdSizeChange(householdSize - 1)}
                  disabled={isLoading || householdSize <= 1}
                  aria-label={t('decreaseAria')}
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </Button>
                <NumberInput
                  id="householdSize"
                  integer
                  value={householdSize}
                  onValueChange={(v) => handleHouseholdSizeChange(v ?? 1)}
                  disabled={isLoading}
                  className="w-16 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => handleHouseholdSizeChange(householdSize + 1)}
                  disabled={isLoading || householdSize >= 10}
                  aria-label={t('increaseAria')}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Label>{t('membersLabel')}</Label>
              <Body variant="muted">{t('membersHelper')}</Body>
              <div className="flex flex-col gap-2">
                {memberRows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={row.name}
                      onChange={(e) => handleMemberNameChange(index, e.target.value)}
                      placeholder={generateDefaultName(index, row)}
                      disabled={isLoading || index === 0}
                      maxLength={100}
                      className="flex-1"
                      aria-label={t('memberAria', { index: index + 1 })}
                    />
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={row.portionType === 'adult' ? 'default' : 'outline'}
                        onClick={() => handlePortionTypeChange(index, 'adult')}
                        disabled={isLoading || index === 0}
                        className="px-3 text-xs"
                      >
                        {t('adult')}
                      </Button>
                      <Button
                        type="button"
                        variant={row.portionType === 'child' ? 'default' : 'outline'}
                        onClick={() => handlePortionTypeChange(index, 'child')}
                        disabled={isLoading || index === 0}
                        className="px-3 text-xs"
                      >
                        {t('child')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const getStepTitle = () => {
    switch (currentStep) {
      case 1:
        return t('nameStepTitle')
      case 2:
        return t('membersStepTitle')
      default:
        return ''
    }
  }

  const getStepDescription = () => {
    switch (currentStep) {
      case 1:
        return t('nameStepDescription')
      case 2:
        return t('membersStepDescription')
      default:
        return ''
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex flex-col gap-2">
          <Body variant="muted">{t('step', { current: currentStep, total: TOTAL_STEPS })}</Body>
          <Heading variant="h4">{getStepTitle()}</Heading>
          <Body variant="muted">{getStepDescription()}</Body>
        </div>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          {renderStepContent()}
          {error && (
            <div className="mt-4">
              <Body variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between gap-2 pt-6">
          {currentStep > 1 ? (
            <Button type="button" variant="outline" onClick={handleBack} disabled={isLoading}>
              {t('back')}
            </Button>
          ) : (
            <div />
          )}
          {currentStep < TOTAL_STEPS ? (
            <Button type="button" onClick={handleNext} disabled={isLoading}>
              {t('continue')}
            </Button>
          ) : (
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t('submitting') : t('submit')}
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}
