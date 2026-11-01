import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MealImageCard, mealImageTitleWidth } from './MealImageCard'

const URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1.png'

describe('MealImageCard with a head', () => {
  const ready = {
    name: 'Lemon garlic chicken',
    imageStatus: 'ready' as const,
    imageUrl: URL,
    imageHue: 264,
  }

  it('runs the image from the card top to the next row, fading out, when rows follow', () => {
    const { container } = render(
      <MealImageCard meal={ready} trailingActions size="sm" head={<p>Head</p>}>
        <p>Note</p>
      </MealImageCard>,
    )
    const card = container.querySelector('[data-slot="card"]') as HTMLElement
    const head = container.querySelector('[data-slot="meal-image-head"]') as HTMLElement
    const wrapper = screen.getByTestId('meal-card-image')

    expect(Array.from(card.children)).toEqual([head, screen.getByText('Note')])
    expect(Array.from(head.children)).toEqual([wrapper, screen.getByText('Head')])
    expect(head).toHaveClass('relative')
    expect(wrapper).toHaveClass('absolute', '-z-10', '-inset-y-2', 'mask-b-from-60%')
    expect(wrapper).not.toHaveClass('inset-y-0', 'h-20')
    // The head keeps the horizontal geometry, fades and `sizes` of the trailing box.
    expect(wrapper).toHaveClass('right-0', 'left-1/2', 'mask-l-from-90%')
    expect(wrapper).not.toHaveClass('mask-r-from-80%')
    expect(screen.getByRole('img')).toHaveAttribute(
      'sizes',
      '(min-width: 768px) 485px, (min-width: 480px) 62vw, 50vw',
    )
  })

  it('runs the image to the card bottom, unfaded, when nothing follows the head', () => {
    render(
      <MealImageCard meal={ready} trailingActions size="sm" head={<p>Head</p>}>
        {false}
        {null}
      </MealImageCard>,
    )
    const wrapper = screen.getByTestId('meal-card-image')

    expect(wrapper).toHaveClass('absolute', '-z-10', '-inset-y-2')
    expect(wrapper).not.toHaveClass('mask-b-from-60%')
  })

  // HON-974: the note lies over the plate, so it is not a row below the head.
  it('lays an overlay over the head without ending the image', () => {
    const { container } = render(
      <MealImageCard
        meal={ready}
        trailingActions
        size="sm"
        head={<p>Head</p>}
        overlay={<p>Note</p>}
      />,
    )
    const card = container.querySelector('[data-slot="card"]') as HTMLElement
    const head = container.querySelector('[data-slot="meal-image-head"]') as HTMLElement
    const overlay = container.querySelector('[data-slot="meal-image-overlay"]') as HTMLElement
    const wrapper = screen.getByTestId('meal-card-image')

    // After the head in the DOM, inside its positioned wrapper, and no row.
    expect(Array.from(card.children)).toEqual([head])
    expect(Array.from(head.children)).toEqual([wrapper, screen.getByText('Head'), overlay])
    expect(overlay).toContainElement(screen.getByText('Note'))
    expect(overlay).toHaveClass('absolute', 'bottom-0', 'right-13', 'max-w-note-slip-actions')
    // Without a placement it rests in the corner, unmoved.
    expect(overlay).not.toHaveClass('translate-x-(--note-x)')
    expect(overlay.getAttribute('style')).toBeNull()
    expect(wrapper).toHaveClass('-inset-y-2')
    expect(wrapper).not.toHaveClass('mask-b-from-60%')
    expect(card).toHaveAttribute('data-meal-overlay')
  })

  it('widens the overlay to the head for the note editor, still clear of the actions', () => {
    const { container } = render(
      <MealImageCard
        meal={ready}
        trailingActions
        size="sm"
        head={<p>Head</p>}
        overlay={<p>Note</p>}
        overlayWide
      />,
    )
    const overlay = container.querySelector('[data-slot="meal-image-overlay"]') as HTMLElement

    expect(overlay).toHaveClass('left-0', 'right-12')
    expect(overlay).not.toHaveClass('max-w-note-slip-actions')
  })

  it('moves the overlay by its scatter and tilts it (HON-975)', () => {
    const { container } = render(
      <MealImageCard
        meal={ready}
        trailingActions
        size="sm"
        head={<p>Head</p>}
        overlay={<p>Note</p>}
        overlayPlacement={{ scatter: { x: -5, y: -2, tilt: 2.5 }, position: null }}
      />,
    )
    const overlay = container.querySelector('[data-slot="meal-image-overlay"]') as HTMLElement

    expect(overlay).toHaveClass('right-13', 'bottom-0', 'translate-x-(--note-x)')
    expect(overlay).not.toHaveAttribute('data-placed')
    expect(overlay.style.getPropertyValue('--note-x')).toBe('-5px')
    expect(overlay.style.getPropertyValue('--note-y')).toBe('-2px')
    expect(overlay.style.getPropertyValue('--note-tilt')).toBe('2.5deg')
    expect(overlay.style.getPropertyValue('--note-left')).toBe('')
  })

  it('lays a placed overlay at its saved fractions, at the same width (HON-975)', () => {
    const { container } = render(
      <MealImageCard
        meal={ready}
        trailingActions
        size="sm"
        head={<p>Head</p>}
        overlay={<p>Note</p>}
        overlayPlacement={{
          scatter: { x: -5, y: -2, tilt: 2.5 },
          position: { x: 0.125, y: 0.5 },
        }}
      />,
    )
    const overlay = container.querySelector('[data-slot="meal-image-overlay"]') as HTMLElement

    expect(overlay).toHaveAttribute('data-placed')
    expect(overlay).toHaveClass(
      'left-(--note-left)',
      'top-(--note-top)',
      '-translate-x-(--note-left)',
      '-translate-y-(--note-top)',
      'max-w-note-slip-actions',
    )
    // The saved place replaces the corner and its scatter; the tilt stays.
    expect(overlay).not.toHaveClass('bottom-0', 'right-13', 'translate-x-(--note-x)')
    expect(overlay.style.getPropertyValue('--note-left')).toBe('12.5%')
    expect(overlay.style.getPropertyValue('--note-top')).toBe('50%')
    expect(overlay.style.getPropertyValue('--note-tilt')).toBe('2.5deg')
  })

  it('opens the editor in the wide box wherever the slip was placed', () => {
    const { container } = render(
      <MealImageCard
        meal={ready}
        trailingActions
        size="sm"
        head={<p>Head</p>}
        overlay={<p>Note</p>}
        overlayWide
        overlayPlacement={{ scatter: { x: 0, y: 0, tilt: 1 }, position: { x: 0.1, y: 0.5 } }}
      />,
    )
    const overlay = container.querySelector('[data-slot="meal-image-overlay"]') as HTMLElement

    expect(overlay).toHaveClass('left-0', 'right-12', 'bottom-0')
    expect(overlay).not.toHaveClass('left-(--note-left)')
    // Not the slip's place, so nothing fits a place to it.
    expect(overlay).not.toHaveAttribute('data-placed')
  })

  it('caps the title for an overlay on a card without an image', () => {
    const { container } = render(
      <MealImageCard
        meal={{ name: 'Lemon garlic chicken', imageStatus: 'none' }}
        size="sm"
        head={<p>Head</p>}
        overlay={<p>Note</p>}
      />,
    )
    const card = container.querySelector('[data-slot="card"]') as HTMLElement

    // The container and group that `mealImageTitleWidth` reads.
    expect(card).toHaveAttribute('data-meal-overlay')
    expect(card).toHaveClass('group/meal-image', '@container/meal-image')
    expect(card).not.toHaveAttribute('data-meal-surface')
  })

  // HON-1096: the planner card's fixed height switches at the card's own
  // container query, with or without an image; the title cap stays off.
  it('keeps the container on a head card without an image or an overlay', () => {
    const { container } = render(
      <MealImageCard
        meal={{ name: 'Lemon garlic chicken', imageStatus: 'none' }}
        size="sm"
        head={<p>Head</p>}
      />,
    )
    const card = container.querySelector('[data-slot="card"]') as HTMLElement

    expect(card).toHaveClass('group/meal-image', '@container/meal-image')
    expect(card).not.toHaveAttribute('data-meal-surface')
    expect(card).not.toHaveAttribute('data-meal-overlay')
  })

  it('leaves an empty overlay out', () => {
    const { container } = render(
      <MealImageCard meal={ready} size="sm" head={<p>Head</p>} overlay={false} />,
    )

    expect(container.querySelector('[data-slot="meal-image-overlay"]')).toBeNull()
    expect(container.querySelector('[data-slot="card"]')).not.toHaveAttribute('data-meal-overlay')
  })

  it('keeps the head mounted when the tint switches on', () => {
    const plain = { name: 'Lemon garlic chicken', imageStatus: 'none' as const }
    const head = <button type="button">Lemon garlic chicken</button>
    const { rerender } = render(<MealImageCard meal={plain} head={head} />)
    const trigger = screen.getByRole('button')

    rerender(<MealImageCard meal={{ ...plain, imageStatus: 'ready', imageUrl: URL }} head={head} />)

    expect(screen.getByRole('button')).toBe(trigger)
    expect(screen.getByTestId('meal-card-image')).toBeInTheDocument()
  })
})
