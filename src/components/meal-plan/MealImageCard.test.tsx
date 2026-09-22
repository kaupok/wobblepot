import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MealImageCard, type MealImageFields } from './MealImageCard'

const URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1.png'

function renderCard(fields: MealImageFields, className = 'gap-2 py-2') {
  const { container } = render(
    <MealImageCard meal={{ name: 'Lemon garlic chicken', ...fields }} className={className}>
      <p>Content</p>
    </MealImageCard>,
  )
  return container.querySelector('[data-slot="card"]') as HTMLElement
}

describe('MealImageCard', () => {
  it('tints the card with the meal hue and blends the image in on the right', () => {
    const card = renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 264 })

    expect(card.style.getPropertyValue('--meal-hue')).toBe('264')
    expect(card).toHaveAttribute('data-meal-surface')
    expect(card).toHaveClass('relative', 'isolate', 'overflow-hidden', 'gap-2', 'py-2')

    const img = screen.getByRole('img', { name: 'Lemon garlic chicken' })
    expect(img).toHaveClass('object-cover')
    const wrapper = screen.getByTestId('meal-card-image')
    expect(wrapper).toHaveClass(
      'right-0',
      'w-5/8',
      '-z-10',
      'mix-blend-multiply',
      'mask-l-from-30%',
    )
    // The image comes first, so the content still reads first after it in the DOM.
    expect(card.firstElementChild).toBe(wrapper)
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('tints a hue of 0, which is a real hue rather than a missing one', () => {
    const card = renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 0 })

    expect(card.style.getPropertyValue('--meal-hue')).toBe('0')
  })

  it('fades the image in once it has loaded', async () => {
    renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 40 })

    const img = screen.getByRole('img')
    expect(img).toHaveClass('opacity-0', 'transition-opacity', 'duration-200', 'ease-out')
    fireEvent.load(img)
    await waitFor(() => expect(img).toHaveClass('opacity-100'))
  })

  // "Unchanged" means exactly the plain Card: its own classes plus the caller's,
  // no tint attribute, no inline style, no image element.
  it.each<[string, MealImageFields]>([
    ['no image fields', {}],
    ['status none', { imageStatus: 'none', imageUrl: null, imageHue: null }],
    ['generating', { imageStatus: 'generating', imageUrl: null, imageHue: null }],
    ['failed', { imageStatus: 'failed', imageUrl: null, imageHue: null }],
    ['ready without a hue', { imageStatus: 'ready', imageUrl: URL, imageHue: null }],
    ['ready without a URL', { imageStatus: 'ready', imageUrl: null, imageHue: 120 }],
  ])('renders the plain card for %s', (_label, fields) => {
    const card = renderCard(fields)

    expect(card.className).toBe(
      'bg-card text-card-foreground flex flex-col rounded-xl border gap-2 py-2',
    )
    expect(card).not.toHaveAttribute('data-meal-surface')
    expect(card).not.toHaveAttribute('style')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByTestId('meal-card-image')).not.toBeInTheDocument()
  })

  it('goes back to the plain card when the image fails to load', async () => {
    const card = renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 264 })

    fireEvent.error(screen.getByRole('img'))
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument())
    // React reuses the same element, so the style attribute can survive empty.
    expect(card).not.toHaveAttribute('data-meal-surface')
    expect(card.style.getPropertyValue('--meal-hue')).toBe('')
    expect(card).not.toHaveClass('isolate')
  })
})
