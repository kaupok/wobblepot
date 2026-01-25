'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { GenerateMealsModal } from './GenerateMealsModal'
import type { WeekContext } from './types'

interface WeekViewActionsProps {
  planId: string
  weekContext: WeekContext
}

export function WeekViewActions({ planId, weekContext }: WeekViewActionsProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setIsModalOpen(true)}>
        Generate meals
      </Button>
      <GenerateMealsModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        planId={planId}
        weekContext={weekContext}
      />
    </>
  )
}
