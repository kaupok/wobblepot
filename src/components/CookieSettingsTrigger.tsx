'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Body } from '@/components/ui/typography'
import { useAnalyticsConsent } from '@/components/ConsentProvider'

export function CookieSettingsTrigger() {
  const { granted, grant, withdraw } = useAnalyticsConsent()
  const [open, setOpen] = useState(false)

  const currentLabel = granted === null ? 'Not set' : granted ? 'Analytics on' : 'Essential only'

  const handleGrant = () => {
    grant()
    setOpen(false)
  }

  const handleWithdraw = () => {
    withdraw()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="link" size="sm" className="h-auto p-0">
          Cookie settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cookie settings</DialogTitle>
          <DialogDescription>
            Essential cookies are always on — they keep you signed in. Analytics cookies are
            optional and help us improve the app.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Body variant="muted">
            Current choice: <span className="text-foreground font-medium">{currentLabel}</span>
          </Body>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleWithdraw}>
            Essential only
          </Button>
          <Button onClick={handleGrant}>Accept analytics</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
