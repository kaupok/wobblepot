import { notFound } from 'next/navigation'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/auth-helpers'

// Gate the whole `/admin` segment here, outside any child `loading.tsx`.
// A segment's `loading.tsx` wraps only its own `page.tsx` in Suspense, not a
// parent layout, so this check resolves before a child skeleton can stream:
// non-admins get the neutral root skeleton and then the 404, never an
// admin-shaped fallback that hints at what lives here.
//
// Child pages keep their own `isAdmin` check. Layouts don't re-render on
// sibling navigation, so this is the UX guard, not the sole gate. `getSession`
// is `cache()`-wrapped, so the layout and page share one session lookup.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  // Return 404 (not 403) so the route does not advertise its existence.
  if (!isAdmin(session)) notFound()
  return children
}
