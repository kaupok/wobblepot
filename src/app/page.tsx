import { Heading, Body } from '@/components/ui/typography'
import { env } from '@/lib/env'

export default function Home() {
  const isDev = process.env.NODE_ENV === 'development'

  return (
    <div className="grid min-h-screen place-items-center">
      <main className="flex flex-col items-center gap-[32px]">
        <Heading>Honkadori</Heading>
        <Body>Honkadori all day</Body>
        {isDev && (
          <Body variant="small" className="text-muted-foreground">
            {env.NEXT_PUBLIC_APP_NAME}
          </Body>
        )}
      </main>
    </div>
  )
}
