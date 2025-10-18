import { Heading, Body } from '@/components/ui/typography'

export default function Home() {
  return (
    <div className="grid min-h-screen place-items-center">
      <main className="flex flex-col items-center gap-[32px]">
        <Heading>Honkadori</Heading>
        <Body>Honkadori all day</Body>
      </main>
    </div>
  )
}
