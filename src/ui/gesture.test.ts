import { describe, it, expect } from 'vitest'
import { SwipeTracker, tapDirection } from './gesture'

const tracker = (trigger: 'move' | 'release', dragSteps = true) => new SwipeTracker({ threshold: 30, trigger, dragSteps })

describe('SwipeTracker', () => {
  it('"move": steps as soon as the finger passes the threshold, not before', () => {
    const t = tracker('move')
    t.begin(100, 100)
    expect(t.move(120, 105)).toEqual([])
    expect(t.move(131, 105)).toEqual(['right'])
    expect(t.end(135, 105)).toBeNull() // already stepped
  })

  it('"move" + drag: later steps need three thresholds more, one step per event, and it can turn', () => {
    const t = tracker('move')
    t.begin(0, 0)
    expect(t.move(95, 0)).toEqual(['right']) // one fast event far past the threshold: still one step
    expect(t.move(170, 0)).toEqual([]) // 75 more: not yet (needs 90)
    expect(t.move(186, 0)).toEqual(['right'])
    expect(t.move(186, 100)).toEqual(['down'])
    expect(t.move(90, 100)).toEqual(['left'])
  })

  it('an ordinary swipe that overshoots the threshold is one step', () => {
    const t = tracker('move')
    t.begin(0, 0)
    const steps = [10, 40, 80, 120, 110].flatMap((x) => t.move(x, 0))
    expect(steps).toEqual(['right'])
  })

  it('"move" without drag: one step per swipe', () => {
    const t = tracker('move', false)
    t.begin(0, 0)
    expect(t.move(200, 0)).toEqual(['right'])
    expect(t.move(400, 0)).toEqual([])
  })

  it('a flick with no move event in between still counts once on release', () => {
    const t = tracker('move')
    t.begin(0, 0)
    expect(t.end(0, -80)).toBe('up')
  })

  it('"release": nothing while moving, one step on release in the dominant direction', () => {
    const t = tracker('release')
    t.begin(0, 0)
    expect(t.move(200, 10)).toEqual([])
    expect(t.end(40, 90)).toBe('down')
  })

  it('a finger that barely moved is a tap', () => {
    const t = tracker('release')
    t.begin(0, 0)
    expect(t.end(5, -4)).toBe('tap')
  })

  it('tapDirection: the side of the area split along its diagonals', () => {
    const rect = { left: 0, top: 0, width: 400, height: 800 }
    expect(tapDirection(200, 50, rect)).toBe('up')
    expect(tapDirection(200, 750, rect)).toBe('down')
    expect(tapDirection(20, 400, rect)).toBe('left')
    expect(tapDirection(380, 380, rect)).toBe('right')
  })
})
