'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('consent.settings')
  const { granted, grant, withdraw } = useAnalyticsConsent()
  const [open, setOpen] = useState(false)

  const currentLabel =
    granted === null ? t('stateNotSet') : granted ? t('stateAnalyticsOn') : t('stateEssentialOnly')

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
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div>
          <Body variant="muted">
            {t('currentChoice')} <span className="text-foreground font-medium">{currentLabel}</span>
          </Body>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleWithdraw}>
            {t('essentialOnly')}
          </Button>
          <Button onClick={handleGrant}>{t('acceptAnalytics')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
