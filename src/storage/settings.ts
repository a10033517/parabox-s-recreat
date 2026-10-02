import { useEffect, useState } from 'react'

// Player settings, saved on this device. Every read and write is guarded like progress.ts:
// a bad stored value falls back to the defaults instead of breaking the app.

export type ControlMode = 'swipe' | 'swipe+dpad' | 'dpad' | 'tap'

export interface Settings {
  controls: ControlMode
  swipeArea: 'screen' | 'board' // where a swipe / tap counts
  swipeTrigger: 'move' | 'release' // step as soon as the finger passes the threshold, or on lift
  dragSteps: boolean // while dragging, one more step every threshold distance (can turn)
  holdRepeat: boolean // after a step, keep the finger down to keep moving that way
  sensitivity: 'high' | 'medium' | 'low'
  haptics: boolean
  tapToInspect: boolean // tap (or long-press) a box to look inside it
  moveRate: MoveRate // the most moves per second, however fast the input comes
}

export type MoveRate = 'unlimited' | 'fast' | 'medium' | 'slow'

const KEY = 'parabox:settings'
const SETTINGS_VERSION = 2

// Phones get swipe-only by default (no D-pad); anything with a mouse keeps the D-pad too.
function touchFirst(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

export function defaultSettings(): Settings {
  return {
    controls: touchFirst() ? 'swipe' : 'swipe+dpad',
    swipeArea: 'screen',
    swipeTrigger: 'move',
    dragSteps: false,
    holdRepeat: false,
    sensitivity: 'medium',
    haptics: true,
    tapToInspect: true,
    moveRate: 'fast',
  }
}

export function loadSettings(): Settings {
  const defaults = defaultSettings()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults
    const stored = JSON.parse(raw) as Partial<Settings> & { version?: number }
    // Version 2: drag steps became opt-in (one swipe = one step); older saves keep the new default.
    if ((stored.version ?? 1) < 2) delete stored.dragSteps
    const { version: _version, ...rest } = stored
    return { ...defaults, ...rest }
  } catch {
    return defaults
  }
}

const listeners = new Set<(s: Settings) => void>()

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION }))
  } catch {
    // storage full / unavailable: the change still applies for this session
  }
  listeners.forEach((l) => l(settings))
}

// The current settings, re-rendering when they change anywhere in the app.
export function useSettings(): [Settings, (next: Settings) => void] {
  const [settings, setSettings] = useState(loadSettings)
  useEffect(() => {
    listeners.add(setSettings)
    return () => {
      listeners.delete(setSettings)
    }
  }, [])
  return [settings, saveSettings]
}

// Shortest time between two moves; inputs that come faster wait their turn (see GameScreen).
export const MOVE_INTERVAL_MS: Record<MoveRate, number> = { unlimited: 0, fast: 125, medium: 200, slow: 320 }

export const SWIPE_THRESHOLD_PX: Record<Settings['sensitivity'], number> = { high: 16, medium: 28, low: 44 }
