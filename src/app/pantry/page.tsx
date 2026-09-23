import { InventoryPage } from '@/components/inventory/InventoryPage'
import { loadInventory } from '../shopping/load-inventory'

interface PantryPageProps {
  searchParams: Promise<{ days?: string }>
}

/**
 * The Pantry tab (HON-776). Same page as `/shopping` from `md` up; on a phone
 * it shows the pantry half instead of the list. `key` does what it does on
 * `/shopping` — see the comment in `src/app/shopping/page.tsx`.
 */
export default async function PantryPage({ searchParams }: PantryPageProps) {
  const { days } = await searchParams
  const data = await loadInventory(days)

  return <InventoryPage key={data.windowDays} view="pantry" {...data} />
}
