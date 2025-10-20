import { Heading, Body } from '@/components/ui/typography'
import { env } from '@/lib/env'

export default function Home() {
  return (
    <div className="grid min-h-screen place-items-center">
      <main className="flex flex-col items-center gap-[32px]">
        <Heading>{env.NEXT_PUBLIC_APP_NAME}</Heading>
        <Body variant="small" className="text-muted-foreground">
          NEXT_PUBLIC_APP_ENV: {env.NEXT_PUBLIC_APP_ENV}
        </Body>
        <Body variant="small" className="text-muted-foreground">
          NEXT_PUBLIC_APP_URL: {env.NEXT_PUBLIC_APP_URL}
        </Body>
      </main>
    </div>
  )
}
