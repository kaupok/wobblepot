'use client'

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
  return (
    <section className="flex flex-col gap-4">
      <Heading variant="h4">Basic information</Heading>

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Meal name</Label>
        <Input
          id="name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={200}
          required
          disabled={disabled}
          placeholder="e.g., Chicken stir fry"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={1000}
          disabled={disabled}
          placeholder="Brief description of the meal..."
          rows={2}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="servings">Recipe makes (servings)</Label>
        <Input
          id="servings"
          type="number"
          value={servings}
          onChange={(e) => onServingsChange(e.target.value)}
          min={1}
          max={50}
          required
          disabled={disabled}
        />
      </div>
    </section>
  )
}
