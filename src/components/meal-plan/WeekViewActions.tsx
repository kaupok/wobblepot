'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ClearWeekModal } from './ClearWeekModal'
import { GenerateMealsModal } from './GenerateMealsModal'
import type { WeekContext } from './types'

interface WeekViewActionsProps {
  planId: string
  weekContext: WeekContext
}

export function WeekViewActions({ planId, weekContext }: WeekViewActionsProps) {
  const [isClearModalOpen, setIsClearModalOpen] = useState(false)
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setIsClearModalOpen(true)}>
        Clear
      </Button>
      <Button variant="outline" size="sm" onClick={() => setIsGenerateModalOpen(true)}>
        Generate meals
      </Button>
      <ClearWeekModal open={isClearModalOpen} onOpenChange={setIsClearModalOpen} planId={planId} />
      <GenerateMealsModal
        open={isGenerateModalOpen}
        onOpenChange={setIsGenerateModalOpen}
        planId={planId}
        weekContext={weekContext}
      />
    </div>
  )
}
