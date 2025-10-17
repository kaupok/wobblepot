import { H1, P } from '@/components/ui/typography'

export default function Home() {
  return (
    <div className="grid min-h-screen place-items-center">
      <main className="flex flex-col items-center gap-[32px]">
        <H1>Honkadori</H1>
        <P>Honkadori all day</P>
      </main>
    </div>
  )
}
