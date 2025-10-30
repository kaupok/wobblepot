import { Suspense } from 'react'
import { SignInForm } from './SignInForm'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'

export default function SignInPage() {
  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Suspense fallback={<LoadingFallback />}>
        <SignInForm />
      </Suspense>
    </div>
  )
}

function LoadingFallback() {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center p-8">
        <Body variant="muted">Loading...</Body>
      </CardContent>
    </Card>
  )
}
