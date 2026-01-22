import { redirect } from 'next/navigation'

// Invites page has been deprecated - redirect to household page
// Invite functionality is now available directly on the Members section
export default function InviteSettingsPage() {
  redirect('/household')
}
