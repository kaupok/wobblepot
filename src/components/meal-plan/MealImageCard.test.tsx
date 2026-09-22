import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MealImageCard, mealImageTitleWidth, type MealImageFields } from './MealImageCard'

const URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1.png'

function renderCard(fields: MealImageFields, className = 'gap-2 py-2', trailingActions?: boolean) {
  const { container } = render(
    <MealImageCard
      meal={{ name: 'Lemon garlic chicken', ...fields }}
      className={className}
      trailingActions={trailingActions}
    >
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
      'w-9/20',
      'sm:w-5/8',
      '-z-10',
      'mix-blend-multiply',
      'mask-l-from-30%',
    )
    // The image comes first, so the content still reads first after it in the DOM.
    expect(card.firstElementChild).toBe(wrapper)
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  // HON-749: nothing the user taps sits on the opaque image.
  it('ends the image before a trailing action column', () => {
    renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 264 }, undefined, true)

    const wrapper = screen.getByTestId('meal-card-image')
    expect(wrapper).toHaveClass('right-36', 'left-1/3', 'sm:left-3/8', 'mask-r-from-80%')
    expect(wrapper).toHaveClass('mask-l-from-30%', 'mix-blend-multiply')
    expect(wrapper).not.toHaveClass('right-0', 'w-9/20', 'sm:w-5/8')
  })

  it('narrows the title to the tint left of the image', () => {
    // Scoped to a tinted card, so a card whose image fails goes back to the full row.
    expect(mealImageTitleWidth()).toBe(
      'group-data-meal-surface/meal-image:max-w-1/2 sm:group-data-meal-surface/meal-image:max-w-3/8',
    )
    expect(mealImageTitleWidth(true)).toBe(
      'group-data-meal-surface/meal-image:max-w-1/3 sm:group-data-meal-surface/meal-image:max-w-3/8',
    )
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

  it('keeps the content mounted when the tint switches on', () => {
    const plain = { name: 'Lemon garlic chicken', imageStatus: 'none' as const }
    const { rerender } = render(
      <MealImageCard meal={plain}>
        <button type="button">Lemon garlic chicken</button>
      </MealImageCard>,
    )
    const trigger = screen.getByRole('button')

    rerender(
      <MealImageCard meal={{ ...plain, imageStatus: 'ready', imageUrl: URL, imageHue: 40 }}>
        <button type="button">Lemon garlic chicken</button>
      </MealImageCard>,
    )

    // The same node, not a remount: focus restore on modal close targets it.
    expect(screen.getByRole('button')).toBe(trigger)
    expect(trigger.isConnected).toBe(true)
    expect(screen.getByTestId('meal-card-image')).toBeInTheDocument()
  })
})
