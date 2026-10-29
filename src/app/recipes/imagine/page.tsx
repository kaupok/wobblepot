import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'

import { ImagineClient } from './ImagineClient'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recipes.imagine')
  return { title: t('metaTitle') }
}

export default async function ImagineMealPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    redirect('/')
  }

  return <ImagineClient />
}
