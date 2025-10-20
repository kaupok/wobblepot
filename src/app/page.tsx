import { Heading, Body } from '@/components/ui/typography'
import { env } from '@/lib/env'

export default function Home() {
  return (
    <div className="grid min-h-screen place-items-center">
      <main className="flex flex-col items-center gap-[32px]">
        <Heading>Honkadori</Heading>
        <Body>Honkadori all day</Body>
        <Body variant="small" className="text-muted-foreground">
          App: {env.NEXT_PUBLIC_APP_NAME}
        </Body>
        <Body variant="small" className="text-muted-foreground">
          Env: {process.env.NODE_ENV}
        </Body>
      </main>
    </div>
  )
}
