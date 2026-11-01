import { describe, expect, it } from 'vitest'

import { leafPlantName } from './leaf-plant-match'

describe('leafPlantName', () => {
  it('gives the plant when the best match does not name it', () => {
    expect(leafPlantName('basil leaves', 'bay leaves')).toBe('basil')
    expect(leafPlantName('mint leaf', undefined)).toBe('mint')
  })

  it('keeps a best match that holds every word of the plant', () => {
    expect(leafPlantName('bay leaves', 'bay leaves')).toBeNull()
    expect(leafPlantName('lime leaves', 'kaffir lime leaves')).toBeNull()
  })

  it('gives nothing for a name that does not end in "leaves" or "leaf"', () => {
    expect(leafPlantName('basil', 'bay leaves')).toBeNull()
    expect(leafPlantName('leaves', undefined)).toBeNull()
  })
})
