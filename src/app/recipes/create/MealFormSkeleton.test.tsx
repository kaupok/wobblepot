import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import RecipeImportLoading from '../import/loading'
import { MealFormSkeleton } from './MealFormSkeleton'

// The skeletons copy the pages' centred column, so nothing shifts sideways
// when the form arrives (HON-1368).
describe('form page skeleton columns', () => {
  it.each([
    ['MealFormSkeleton', <MealFormSkeleton key="meal" />],
    ['recipe import loading', <RecipeImportLoading key="import" />],
  ])('%s centres a max-w-2xl column', (_name, node) => {
    const { container } = render(node)
    expect(container.querySelector('.max-w-2xl')).toHaveClass('mx-auto')
  })
})
