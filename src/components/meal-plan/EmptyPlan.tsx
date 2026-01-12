import { Heading, Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'

export function EmptyPlan() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Heading variant="h2">No meal plan for this week</Heading>
        <Body variant="muted">Generate your first meal plan to get started.</Body>
      </div>
      <Button disabled>Generate meal plan</Button>
    </div>
  )
}
