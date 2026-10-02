import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, loadSettings, saveSettings } from './settings'

describe('settings', () => {
  beforeEach(() => localStorage.clear())

  it('drag steps are off by default: one swipe is one step', () => {
    expect(defaultSettings().dragSteps).toBe(false)
  })

  it('a save from before version 2 drops its drag-steps choice, keeps the rest', () => {
    localStorage.setItem('parabox:settings', JSON.stringify({ dragSteps: true, sensitivity: 'low' }))
    expect(loadSettings()).toMatchObject({ dragSteps: false, sensitivity: 'low' })
  })

  it('a choice saved now is kept', () => {
    saveSettings({ ...defaultSettings(), dragSteps: true })
    expect(loadSettings().dragSteps).toBe(true)
  })
})
