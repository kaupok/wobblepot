// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { MEAL_IMAGE_PROMPT_VERSION } from './prompt'
import { presentMealImage } from './present'

const URL = 'https://store.public.blob.vercel-storage.com/meals/meal-1-abc.png'

describe('presentMealImage', () => {
  it('passes a ready image at the current prompt version through', () => {
    expect(
      presentMealImage({
        imageStatus: 'ready',
        imageUrl: URL,
        imageHue: 120,
        imagePromptVersion: MEAL_IMAGE_PROMPT_VERSION,
      }),
    ).toEqual({ imageStatus: 'ready', imageUrl: URL, imageHue: 120 })
  })

  it.each(['v3', null])('presents a ready image at version %s as absent', (imagePromptVersion) => {
    expect(
      presentMealImage({ imageStatus: 'ready', imageUrl: URL, imageHue: null, imagePromptVersion }),
    ).toEqual({ imageStatus: 'none', imageUrl: null, imageHue: null })
  })

  it.each(['none', 'generating', 'failed'] as const)(
    'leaves a %s status untouched whatever its version',
    (imageStatus) => {
      expect(
        presentMealImage({ imageStatus, imageUrl: null, imageHue: null, imagePromptVersion: 'v3' }),
      ).toEqual({ imageStatus, imageUrl: null, imageHue: null })
    },
  )
})
