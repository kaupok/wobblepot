'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Heading, Body } from '@/components/ui/typography'

const PROGRESS_MESSAGES = [
  'Analyzing your preferences...',
  'Finding balanced meals...',
  'Ensuring variety for the week...',
  'Almost there...',
]

const MESSAGE_INTERVAL_MS = 3000
const SLOW_THRESHOLD_MS = 10000

export function GeneratingOverlay() {
  const [messageIndex, setMessageIndex] = useState(0)
  const [isSlow, setIsSlow] = useState(false)

  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % PROGRESS_MESSAGES.length)
    }, MESSAGE_INTERVAL_MS)

    const slowTimeout = setTimeout(() => {
      setIsSlow(true)
    }, SLOW_THRESHOLD_MS)

    return () => {
      clearInterval(messageInterval)
      clearTimeout(slowTimeout)
    }
  }, [])

  const displayMessage = isSlow
    ? 'Taking longer than expected, please wait...'
    : PROGRESS_MESSAGES[messageIndex]

  return (
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 text-center">
        <Loader2 className="text-primary h-12 w-12 animate-spin" />
        <div className="flex flex-col items-center gap-2">
          <Heading variant="h2">Generating your meal plan...</Heading>
          <Body variant="muted">{displayMessage}</Body>
        </div>
      </div>
    </div>
  )
}
