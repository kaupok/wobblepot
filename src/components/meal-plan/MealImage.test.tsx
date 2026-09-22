import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MealImage } from './MealImage'

const URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1.png'

describe('MealImage', () => {
  it('renders the illustration with the meal name as alt text', () => {
    render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={264} />,
    )

    const img = screen.getByRole('img', { name: 'Lemon garlic chicken' })
    expect(img).toHaveAttribute('alt', 'Lemon garlic chicken')
    expect(img).toHaveAttribute(
      'sizes',
      '(min-width: 768px) 624px, (min-width: 640px) 400px, calc(100vw - 5rem)',
    )
  })

  it('puts the image on the meal tint, multiplied in and fading bottom-up', () => {
    render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={264} />,
    )

    const img = screen.getByRole('img')
    expect(img).toHaveClass('object-cover', 'mix-blend-multiply')
    const hero = screen.getByTestId('meal-image-hero')
    expect(hero).toBe(img.parentElement)
    expect(hero.style.getPropertyValue('--meal-hue')).toBe('264')
    expect(hero).toHaveAttribute('data-meal-surface')
    expect(hero).toHaveClass('aspect-3/2', 'isolate', 'overflow-hidden', 'mask-b-from-60%')
    // No neutral box behind the image any more: the tint is the surface.
    expect(hero).not.toHaveClass('bg-muted')
  })

  it('renders nothing for a ready image without a hue', () => {
    const { container } = render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={null} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('fades the image in once it has loaded', async () => {
    render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={264} />,
    )

    const img = screen.getByRole('img')
    expect(img).toHaveClass('opacity-0', 'transition-opacity', 'duration-200', 'ease-out')
    fireEvent.load(img)
    // next/image calls `onLoad` after its own decode step, not synchronously.
    await waitFor(() => expect(img).toHaveClass('opacity-100'))
  })

  it('renders nothing once the image URL fails to load', async () => {
    const { container } = render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={264} />,
    )

    fireEvent.error(screen.getByRole('img'))
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it.each(['none', 'failed'] as const)(
    'renders no image element and no placeholder when %s',
    (status) => {
      const { container } = render(
        <MealImage
          mealName="Lemon garlic chicken"
          status={status}
          imageUrl={null}
          imageHue={null}
        />,
      )

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    },
  )

  it('renders nothing for a ready status without a URL', () => {
    const { container } = render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={null} imageHue={null} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders only a plain 3:2 box while generating', () => {
    const { container } = render(
      <MealImage
        mealName="Lemon garlic chicken"
        status="generating"
        imageUrl={null}
        imageHue={null}
      />,
    )

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const box = screen.getByTestId('meal-image-placeholder')
    expect(container.childNodes).toHaveLength(1)
    expect(box).toBeEmptyDOMElement()
    expect(box).toHaveClass('bg-muted', 'aspect-3/2', 'rounded-lg')
    expect(box.className).not.toMatch(/animate-/)
  })
})
