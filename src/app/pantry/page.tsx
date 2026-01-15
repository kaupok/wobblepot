import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { PantryList } from '@/components/pantry/PantryList'

export default async function PantryPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId: membership.householdId },
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          category: true,
          defaultUnit: true,
        },
      },
    },
    orderBy: [{ isStaple: 'desc' }, { ingredient: { name: 'asc' } }],
  })

  const items = pantryItems.map((item) => ({
    id: item.id,
    ingredient: item.ingredient,
    quantity: item.quantity,
    isStaple: item.isStaple,
    updatedAt: item.updatedAt.toISOString(),
  }))

  return (
    <div className="container mx-auto max-w-2xl p-4">
      <PantryList initialItems={items} />
    </div>
  )
}
