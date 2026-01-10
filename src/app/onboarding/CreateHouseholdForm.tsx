'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Heading, Body } from '@/components/ui/typography'

interface CreateHouseholdFormProps {
  userName: string
}

export function CreateHouseholdForm({ userName }: CreateHouseholdFormProps) {
  const router = useRouter()
  const [name, setName] = useState(`${userName}'s Household`)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.error === 'already_in_household') {
          // User already has a household, redirect to home
          router.push('/')
          router.refresh()
          return
        }
        setError(data.message || data.error || 'Failed to create household')
        return
      }

      router.push('/')
      router.refresh()
    } catch {
      setError('Unable to connect. Please check your internet connection.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <Heading variant="h2">Create your household</Heading>
        </CardTitle>
        <CardDescription>
          <Body variant="muted">Set up your household to start planning meals</Body>
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Household name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isLoading}
                maxLength={100}
              />
            </div>
            {error && (
              <Body variant="small" className="text-destructive" role="alert">
                {error}
              </Body>
            )}
          </div>
        </CardContent>
        <CardFooter className="pt-6">
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Create household'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
