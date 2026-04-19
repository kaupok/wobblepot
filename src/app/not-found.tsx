import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <div className="flex flex-col gap-3">
          <Heading variant="h2">Page not found</Heading>
          <Body>The page you&apos;re looking for doesn&apos;t exist or has been moved.</Body>
        </div>
        <div className="mt-6">
          <Button asChild>
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
