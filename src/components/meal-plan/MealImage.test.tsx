import { afterEach, describe, it, expect, vi } from 'vitest'
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
      '(min-width: 768px) 670px, (min-width: 640px) 446px, calc(100vw - 2rem)',
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
    expect(hero).toHaveClass('isolate', 'overflow-hidden', 'mask-b-from-60%', 'mask-t-from-85%')
    // No neutral box behind the image any more: the tint is the surface.
    expect(hero).not.toHaveClass('bg-muted', 'bg-background')
  })

  it('bleeds the hero through the dialog padding at 2:1 with no radius of its own', () => {
    render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={264} />,
    )

    const hero = screen.getByTestId('meal-image-hero')
    expect(hero).toHaveClass('-mx-6', 'aspect-2/1')
    expect(hero.className).not.toMatch(/\brounded-/)
  })

  // HON-754: the image stays, on the dialog's own surface, untinted.
  it('renders a ready image without a hue on a neutral surface', () => {
    render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={null} />,
    )

    const hero = screen.getByTestId('meal-image-hero')
    expect(hero).toHaveAttribute('data-meal-surface', 'neutral')
    expect(hero).not.toHaveAttribute('style')
    // The multiply needs a backdrop inside the isolated hero: the dialog's own.
    expect(hero).toHaveClass('isolate', 'bg-background')
    expect(screen.getByRole('img', { name: 'Lemon garlic chicken' })).toHaveClass(
      'mix-blend-multiply',
    )
  })

  describe('an image that is already complete', () => {
    afterEach(() => vi.restoreAllMocks())

    // HON-754: a cache hit loads before React attaches `onLoad`.
    it('shows it without waiting for a load event', () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(279)
      render(
        <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={264} />,
      )

      expect(screen.getByRole('img')).toHaveClass('opacity-100')
    })
  })

  it('fades a new image in again when the URL changes', async () => {
    const { rerender } = render(
      <MealImage mealName="Lemon garlic chicken" status="ready" imageUrl={URL} imageHue={264} />,
    )
    fireEvent.load(screen.getByRole('img'))
    await waitFor(() => expect(screen.getByRole('img')).toHaveClass('opacity-100'))

    rerender(
      <MealImage
        mealName="Lemon garlic chicken"
        status="ready"
        imageUrl={`${URL}?v=2`}
        imageHue={264}
      />,
    )

    expect(screen.getByRole('img')).toHaveClass('opacity-0')
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

  it('renders only a plain box with the hero geometry while generating', () => {
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
    expect(box).toHaveClass('bg-muted', '-mx-6', 'aspect-2/1')
    expect(box.className).not.toMatch(/\brounded-/)
    expect(box.className).not.toMatch(/animate-/)
  })
})
