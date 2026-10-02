import { afterEach, describe, expect, it, vi } from 'vitest'
import { MusicPlayer } from './music'

// A minimal stand-in for Web Audio: records oscillators and gain ramps.
class FakeParam {
  value = 0
  ramps: [number, number][] = []
  setValueAtTime(v: number) { this.value = v }
  linearRampToValueAtTime(v: number, t: number) { this.ramps.push([v, t]); this.value = v }
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
}
class FakeNode {
  gain = new FakeParam()
  frequency = new FakeParam()
  delayTime = new FakeParam()
  type = ''
  onended: (() => void) | null = null
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}
class FakeContext {
  static instances: FakeContext[] = []
  state = 'running'
  currentTime = 0
  destination = new FakeNode()
  oscillators = 0
  constructor() { FakeContext.instances.push(this) }
  createGain() { return new FakeNode() }
  createDelay() { return new FakeNode() }
  createBiquadFilter() { return new FakeNode() }
  createOscillator() { this.oscillators++; return new FakeNode() }
  resume() { return Promise.resolve() }
  suspend() { return Promise.resolve() }
}

afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { AudioContext?: unknown }).AudioContext
  FakeContext.instances = []
})

describe('MusicPlayer', () => {
  it('without Web Audio every call is a silent no-op', () => {
    const player = new MusicPlayer()
    expect(player.available).toBe(false)
    expect(() => {
      player.unlock()
      player.setVolume(1)
      player.setTheme('void')
      player.setHidden(true)
    }).not.toThrow()
  })

  it('makes no sound before a gesture unlocks it, then schedules notes', () => {
    vi.useFakeTimers()
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext
    const player = new MusicPlayer(() => 0.1)
    player.setVolume(0.6)
    expect(FakeContext.instances).toHaveLength(0)
    player.unlock()
    const ctx = FakeContext.instances[0]
    vi.advanceTimersByTime(200)
    expect(ctx.oscillators).toBeGreaterThan(0)
  })

  it('switching to the Void theme starts its drone and cross-fades', () => {
    vi.useFakeTimers()
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext
    const player = new MusicPlayer(() => 0.9)
    player.setVolume(0.6)
    player.unlock()
    const ctx = FakeContext.instances[0]
    const before = ctx.oscillators
    player.setTheme('void')
    expect(ctx.oscillators).toBeGreaterThanOrEqual(before + 4) // three drone voices + the slow swell
    player.setTheme('void') // same theme again: nothing new
    expect(ctx.oscillators).toBeLessThanOrEqual(before + 4)
  })

  it('volume off stops scheduling notes', () => {
    vi.useFakeTimers()
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext
    const player = new MusicPlayer(() => 0.1)
    player.setVolume(0.6)
    player.unlock()
    const ctx = FakeContext.instances[0]
    player.setVolume(0)
    const count = ctx.oscillators
    ctx.currentTime = 5
    vi.advanceTimersByTime(1000)
    expect(ctx.oscillators).toBe(count)
  })
})
