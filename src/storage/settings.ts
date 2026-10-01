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
}

const KEY = 'parabox:settings'

// Phones get swipe-only by default (no D-pad); anything with a mouse keeps the D-pad too.
function touchFirst(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}

export function defaultSettings(): Settings {
  return {
    controls: touchFirst() ? 'swipe' : 'swipe+dpad',
    swipeArea: 'screen',
    swipeTrigger: 'move',
    dragSteps: true,
    holdRepeat: false,
    sensitivity: 'medium',
    haptics: true,
    tapToInspect: true,
  }
}

export function loadSettings(): Settings {
  const defaults = defaultSettings()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults
    const stored = JSON.parse(raw) as Partial<Settings>
    return { ...defaults, ...stored }
  } catch {
    return defaults
  }
}

const listeners = new Set<(s: Settings) => void>()

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
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

export const SWIPE_THRESHOLD_PX: Record<Settings['sensitivity'], number> = { high: 16, medium: 28, low: 44 }
