import { afterEach, describe, it, expect, vi } from 'vitest'
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
    // The image geometry follows the card's width, not the viewport's.
    expect(card).toHaveClass('@container/meal-image')

    const img = screen.getByRole('img', { name: 'Lemon garlic chicken' })
    expect(img).toHaveClass('object-cover')
    const wrapper = screen.getByTestId('meal-card-image')
    expect(wrapper).toHaveClass(
      'right-0',
      'w-9/20',
      '@md/meal-image:w-5/8',
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
    expect(wrapper).toHaveClass(
      'right-36',
      'left-1/3',
      '@md/meal-image:left-3/8',
      'mask-r-from-80%',
    )
    expect(wrapper).toHaveClass('mask-l-from-30%', 'mix-blend-multiply')
    expect(wrapper).not.toHaveClass('right-0', 'w-9/20', '@md/meal-image:w-5/8')
  })

  // HON-755: the planner card's lower rows sit on the tint, not the dish.
  it('confines the side image to the title row band', () => {
    render(
      <MealImageCard
        meal={{ name: 'Lemon garlic chicken', imageStatus: 'ready', imageUrl: URL, imageHue: 264 }}
        trailingActions
        titleBand
      >
        <p>Content</p>
      </MealImageCard>,
    )
    const wrapper = screen.getByTestId('meal-card-image')

    expect(wrapper).toHaveClass('absolute', 'top-0', 'h-12', 'mask-b-from-60%', '-z-10')
    expect(wrapper).not.toHaveClass('inset-y-0')
    // The band keeps the horizontal geometry and fades of the trailing box.
    expect(wrapper).toHaveClass('right-36', 'left-1/3', 'mask-l-from-30%', 'mask-r-from-80%')
    expect(screen.getByRole('img')).toHaveAttribute('sizes', '(min-width: 768px) 341px, 40vw')
  })

  // HON-750: a tall card puts the image below the content instead of behind it.
  it('renders a bottom image in flow after the content and before the footer', () => {
    const { container } = render(
      <MealImageCard
        meal={{ name: 'Lemon garlic chicken', imageStatus: 'ready', imageUrl: URL, imageHue: 264 }}
        layout="bottom"
        footer={<button type="button">Select</button>}
      >
        <p>Content</p>
      </MealImageCard>,
    )
    const card = container.querySelector('[data-slot="card"]') as HTMLElement
    const wrapper = screen.getByTestId('meal-card-image')
    const [content, image, footer] = Array.from(card.children)

    expect(content).toBe(screen.getByText('Content'))
    expect(image).toBe(wrapper)
    expect(footer).toBe(screen.getByRole('button', { name: 'Select' }))
    expect(wrapper).toHaveClass(
      'relative',
      'aspect-3/2',
      'w-full',
      'mask-t-from-60%',
      'mix-blend-multiply',
    )
    expect(wrapper).not.toHaveClass('absolute', '-z-10', 'mask-l-from-30%')
    expect(screen.getByRole('img')).toHaveAttribute('sizes', '(min-width: 768px) 364px, 100vw')
    // Still tinted, but without the named group the title cap never applies.
    expect(card).toHaveAttribute('data-meal-surface')
    expect(card).toHaveClass('relative', 'isolate', 'overflow-hidden')
    expect(card).not.toHaveClass('group/meal-image', '@container/meal-image')
  })

  // HON-748: each surface's `sizes` describes its own image box, so a DPR 2
  // screen fetches a file at least twice the rendered width.
  describe('sizes per surface', () => {
    const ready: MealImageFields = { imageStatus: 'ready', imageUrl: URL, imageHue: 264 }

    it('describes the recipes-list side image up to the widest card', () => {
      renderCard(ready)
      expect(screen.getByRole('img')).toHaveAttribute('sizes', '(min-width: 768px) 485px, 62vw')
    })

    it('describes the planner side image, which ends before the action column', () => {
      renderCard(ready, undefined, true)
      expect(screen.getByRole('img')).toHaveAttribute('sizes', '(min-width: 768px) 341px, 40vw')
    })

    it('describes the add-meal dialog bottom image as one grid column', () => {
      render(
        <MealImageCard meal={{ name: 'Lemon garlic chicken', ...ready }} layout="bottom">
          <p>Content</p>
        </MealImageCard>,
      )
      expect(screen.getByRole('img')).toHaveAttribute('sizes', '(min-width: 768px) 364px, 100vw')
    })
  })

  it('renders the side image as the absolutely positioned wrapper ahead of the content', () => {
    const card = renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 264 })
    const wrapper = screen.getByTestId('meal-card-image')

    expect(card.firstElementChild).toBe(wrapper)
    expect(wrapper).toHaveClass('absolute', 'inset-y-0', '-z-10')
    expect(wrapper).not.toHaveClass('top-0', 'h-12', 'mask-b-from-60%')
    expect(card).toHaveClass('group/meal-image')
  })

  it('renders the footer on a plain bottom card with no image', () => {
    const { container } = render(
      <MealImageCard
        meal={{ name: 'Lemon garlic chicken' }}
        layout="bottom"
        footer={<span>Foot</span>}
      >
        <p>Content</p>
      </MealImageCard>,
    )
    const card = container.querySelector('[data-slot="card"]') as HTMLElement

    expect(Array.from(card.children).map((el) => el.textContent)).toEqual(['Content', 'Foot'])
    expect(screen.queryByTestId('meal-card-image')).not.toBeInTheDocument()
  })

  it('narrows the title to the tint left of the image', () => {
    // Scoped to a tinted card, so a card whose image fails goes back to the full row.
    expect(mealImageTitleWidth()).toBe(
      'group-data-meal-surface/meal-image:max-w-1/2 @md/meal-image:group-data-meal-surface/meal-image:max-w-3/8',
    )
    expect(mealImageTitleWidth(true)).toBe(
      'group-data-meal-surface/meal-image:max-w-1/3 @md/meal-image:group-data-meal-surface/meal-image:max-w-3/8',
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

  // HON-754: an image already loaded before React attached `onLoad` (a cache
  // hit, or a load that beat hydration) never fires it, so the ref has to see it.
  describe('an image that is already complete', () => {
    afterEach(() => vi.restoreAllMocks())

    it('shows it without waiting for a load event', () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(279)
      renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 40 })

      expect(screen.getByRole('img')).toHaveClass('opacity-100')
    })

    it('waits for the load event while the image has no pixels yet', () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0)
      renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: 40 })

      expect(screen.getByRole('img')).toHaveClass('opacity-0')
    })
  })

  it('fades a new image in again when the URL changes', async () => {
    const meal = { name: 'Lemon garlic chicken', imageStatus: 'ready' as const, imageHue: 40 }
    const { rerender } = render(<MealImageCard meal={{ ...meal, imageUrl: URL }} />)
    fireEvent.load(screen.getByRole('img'))
    await waitFor(() => expect(screen.getByRole('img')).toHaveClass('opacity-100'))

    rerender(<MealImageCard meal={{ ...meal, imageUrl: `${URL}?v=2` }} />)

    expect(screen.getByRole('img')).toHaveClass('opacity-0')
  })

  // HON-754: a picture that was generated is never hidden by its colour.
  it('shows an image without a hue on the neutral card', () => {
    const card = renderCard({ imageStatus: 'ready', imageUrl: URL, imageHue: null })

    expect(card).toHaveAttribute('data-meal-surface', 'neutral')
    expect(card.style.getPropertyValue('--meal-hue')).toBe('')
    expect(card).toHaveClass('relative', 'isolate', 'overflow-hidden', '@container/meal-image')
    expect(screen.getByRole('img', { name: 'Lemon garlic chicken' })).toBeInTheDocument()
    expect(screen.getByTestId('meal-card-image')).toHaveClass('mix-blend-multiply')
  })

  // "Unchanged" means exactly the plain Card: its own classes plus the caller's,
  // no tint attribute, no inline style, no image element.
  it.each<[string, MealImageFields]>([
    ['no image fields', {}],
    ['status none', { imageStatus: 'none', imageUrl: null, imageHue: null }],
    ['generating', { imageStatus: 'generating', imageUrl: null, imageHue: null }],
    ['failed', { imageStatus: 'failed', imageUrl: null, imageHue: null }],
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

  it('keeps the content mounted when the tint switches on in the bottom layout', () => {
    const plain = { name: 'Lemon garlic chicken', imageStatus: 'none' as const }
    const { rerender } = render(
      <MealImageCard meal={plain} layout="bottom">
        <button type="button">Lemon garlic chicken</button>
      </MealImageCard>,
    )
    const trigger = screen.getByRole('button')

    rerender(
      <MealImageCard
        meal={{ ...plain, imageStatus: 'ready', imageUrl: URL, imageHue: 40 }}
        layout="bottom"
      >
        <button type="button">Lemon garlic chicken</button>
      </MealImageCard>,
    )

    expect(screen.getByRole('button')).toBe(trigger)
    expect(screen.getByTestId('meal-card-image')).toBeInTheDocument()
  })
})
