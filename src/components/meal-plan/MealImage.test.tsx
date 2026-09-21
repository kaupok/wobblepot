import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MealImage } from './MealImage'

const URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1.png'

describe('MealImage', () => {
  it('renders the illustration with the meal name as alt text', () => {
    render(<MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} />)

    const img = screen.getByRole('img', { name: 'Lemon garlic chicken' })
    expect(img).toHaveAttribute('alt', 'Lemon garlic chicken')
    expect(img).toHaveAttribute('sizes', expect.stringContaining('624px'))
    expect(img.parentElement).toHaveClass('aspect-3/2', 'rounded-lg')
  })

  it('fades the image in once it has loaded', async () => {
    render(<MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} />)

    const img = screen.getByRole('img')
    expect(img).toHaveClass('opacity-0', 'transition-opacity', 'duration-200', 'ease-out')
    fireEvent.load(img)
    // next/image calls `onLoad` after its own decode step, not synchronously.
    await waitFor(() => expect(img).toHaveClass('opacity-100'))
  })

  it.each(['none', 'failed'] as const)(
    'renders no image element and no placeholder when %s',
    (status) => {
      const { container } = render(
        <MealImage mealName="Lemon garlic chicken" status={status} imageUrl={null} />,
      )

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    },
  )

  it('renders nothing for a ready status without a URL', () => {
    const { container } = render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={null} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders only a plain 3:2 box while generating', () => {
    const { container } = render(
      <MealImage mealName="Lemon garlic chicken" status="generating" imageUrl={null} />,
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const box = screen.getByTestId('meal-image-placeholder')
    expect(container.childNodes).toHaveLength(1)
    expect(box).toBeEmptyDOMElement()
    expect(box).toHaveClass('bg-muted', 'aspect-3/2', 'rounded-lg')
    expect(box.className).not.toMatch(/animate-/)
  })
})
