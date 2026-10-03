import { describe, expect, it } from 'vitest'
import { asVesselEstimate, vesselConsensus } from './vessel'

describe('HON-1024: vessel estimate', () => {
  it('reads a model answer, and rejects an unknown vessel or a size no dishware comes in', () => {
    expect(asVesselEstimate({ vessel: 'plate', diameterCm: 26.6 })).toEqual({
      vessel: 'plate',
      diameterCm: 27,
    })
    expect(asVesselEstimate({ vessel: 'tureen', diameterCm: 27 })).toBeNull()
    expect(asVesselEstimate({ vessel: 'plate', diameterCm: 300 })).toBeNull()
    expect(asVesselEstimate({ vessel: 'plate' })).toBeNull()
    expect(asVesselEstimate(undefined)).toBeNull()
  })

  it('settles samples on the vessel most named and the median of its sizes', () => {
    expect(
      vesselConsensus([
        { vessel: 'plate', diameterCm: 22 },
        { vessel: 'plate', diameterCm: 24 },
        { vessel: 'plate', diameterCm: 22 },
      ]),
    ).toEqual({ vessel: 'plate', diameterCm: 22 })
    // The odd one out does not vote on the size.
    expect(
      vesselConsensus([
        { vessel: 'bowl', diameterCm: 16 },
        { vessel: 'plate', diameterCm: 27 },
        { vessel: 'bowl', diameterCm: 18 },
      ]),
    ).toEqual({ vessel: 'bowl', diameterCm: 17 })
    expect(vesselConsensus([{ vessel: 'glass', diameterCm: 8 }])).toEqual({
      vessel: 'glass',
      diameterCm: 8,
    })
    expect(vesselConsensus([])).toBeNull()
  })
})
