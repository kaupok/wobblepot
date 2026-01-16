import { redirect } from 'next/navigation'

// Invites page has been deprecated - redirect to members page
// Invite functionality is now available directly on the Members page
export default function InviteSettingsPage() {
  redirect('/household/members')
}
