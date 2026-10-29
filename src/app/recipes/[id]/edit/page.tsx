import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'

import { EditRecipeClient } from './EditRecipeClient'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recipes.edit')
  return { title: t('metaTitle') }
}

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

  return <EditRecipeClient mealId={id} />
}
