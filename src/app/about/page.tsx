import { Heading, Body } from '@/components/ui/typography'

export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <Heading>About Honkadori</Heading>
        <Body>
          Honkadori is a modern web application built with Next.js 16, React 19, and TypeScript.
        </Body>
        <Body>
          This project showcases best practices in web development, including server-side rendering,
          authentication, and responsive design.
        </Body>
      </div>
    </div>
  )
}
