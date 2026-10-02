import { describe, expect, it } from 'vitest'
import { EyeAnimator } from './eyes'

// A fixed sequence of "random" numbers, so idle timing and gaze are predictable.
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++ % values.length]
}

describe('EyeAnimator', () => {
  it('starts open, looking straight ahead', () => {
    expect(new EyeAnimator(0, seq(0)).sample(0)).toEqual({ lookX: 0, lookY: 0, open: 1 })
  })

  it('turns to look the way the player moved, within a moment', () => {
    const eyes = new EyeAnimator(0, seq(0))
    eyes.look('right', 100)
    const mid = eyes.sample(140)
    expect(mid.lookX).toBeGreaterThan(0)
    expect(mid.lookX).toBeLessThan(1)
    expect(eyes.sample(300)).toEqual({ lookX: 1, lookY: 0, open: 1 })
    eyes.look('up', 400)
    expect(eyes.sample(600)).toMatchObject({ lookX: 0, lookY: -1 })
  })

  it('does not blink while the player keeps moving', () => {
    const eyes = new EyeAnimator(0, seq(0))
    for (let t = 0; t < 5000; t += 500) {
      eyes.look('left', t)
      expect(eyes.sample(t + 100).open).toBe(1)
    }
  })

  it('standing still: blinks, and looks somewhere else once the eyes have shut', () => {
    // random(): 0 -> first idle blink at 1400ms; 0.9 -> not "look ahead"; then the new gaze.
    const eyes = new EyeAnimator(0, seq(0, 0.9, 0.25, 1, 0))
    eyes.sample(0)
    expect(eyes.sample(1399).open).toBe(1)
    expect(eyes.sample(1400).open).toBe(1) // the blink starts
    const shut = eyes.sample(1400 + 85)
    expect(shut.open).toBeLessThan(0.05)
    const after = eyes.sample(1400 + 300)
    expect(after.open).toBe(1)
    // angle 0.25 * 2pi = straight down, radius 1
    expect(after.lookX).toBeCloseTo(0)
    expect(after.lookY).toBeCloseTo(1)
  })

  it('moving during an idle blink cancels the planned look-around', () => {
    const eyes = new EyeAnimator(0, seq(0, 0.9, 0.25, 1, 0))
    eyes.sample(1400) // blink starts, a new gaze is planned
    eyes.look('left', 1420)
    expect(eyes.sample(1700)).toMatchObject({ lookX: -1, lookY: 0 })
  })
})
