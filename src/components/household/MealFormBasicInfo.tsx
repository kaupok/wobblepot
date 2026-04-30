'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Heading } from '@/components/ui/typography'

interface MealFormBasicInfoProps {
  name: string
  onNameChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  servings: string
  onServingsChange: (value: string) => void
  disabled: boolean
}

export function MealFormBasicInfo({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  servings,
  onServingsChange,
  disabled,
}: MealFormBasicInfoProps) {
  const t = useTranslations('recipes.form.basic')

  return (
    <section className="flex flex-col gap-4">
      <Heading variant="h4">{t('heading')}</Heading>

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t('nameLabel')}</Label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={200}
          required
          disabled={disabled}
          placeholder={t('namePlaceholder')}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">{t('descriptionLabel')}</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={1000}
          disabled={disabled}
          placeholder={t('descriptionPlaceholder')}
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="servings">{t('servingsLabel')}</Label>
        <Input
          id="servings"
          type="text"
          inputMode="numeric"
          value={servings}
          onChange={(e) => onServingsChange(e.target.value)}
          required
          disabled={disabled}
        />
      </div>
    </section>
  )
}
