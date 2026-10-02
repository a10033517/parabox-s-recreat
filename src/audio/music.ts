// Background music, synthesised live with Web Audio (no audio files, nothing to license).
// Two themes: 'main' — a soft chord pad, bass and a gentle arpeggio — and 'void' — a low drone
// with sparse, echoing bell tones — cross-faded when the player goes into or out of the Void.
// Browsers only allow sound after a user gesture, so nothing plays until unlock() is called
// from one. Without Web Audio (tests, old browsers) every call is a silent no-op.

export type Theme = 'main' | 'void'

const LOOKAHEAD_S = 0.25 // notes are scheduled this far ahead of the audio clock
const TICK_MS = 50
const FADE_S = 1.6 // theme cross-fade

// Main theme: 84 bpm in eighths, a four-chord loop, two bars per chord.
const MAIN_EIGHTH_S = 60 / 84 / 2
const MAIN_CHORDS: number[][] = [
  [48, 52, 55, 59], // Cmaj7
  [45, 48, 52, 55], // Am7
  [41, 45, 48, 52], // Fmaj7
  [43, 47, 50, 55], // G
]
const STEPS_PER_CHORD = 16

// Void theme: A Phrygian bells over an A / E drone.
const VOID_BELLS = [69, 70, 72, 76, 77, 81, 84]

const midiHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12)

type AudioContextCtor = new () => AudioContext
function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext
}

interface ThemeBus {
  gain: GainNode
  active: boolean // scheduling new notes
  nextTime: number // when the next step / event is due
  step: number
  drone?: { stop: () => void }
}

export class MusicPlayer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private echo: GainNode | null = null // send into the shared echo
  private buses: Partial<Record<Theme, ThemeBus>> = {}
  private theme: Theme = 'main'
  private volume = 0.5
  private timer: number | undefined
  private random: () => number

  constructor(random: () => number = Math.random) {
    this.random = random
  }

  get available(): boolean {
    return audioContextCtor() !== undefined
  }

  // Call from a user gesture: creates (or resumes) the audio and starts the current theme.
  unlock(): void {
    const Ctor = audioContextCtor()
    if (Ctor === undefined) return
    if (this.ctx === null) {
      try {
        this.ctx = new Ctor()
      } catch {
        return
      }
      this.build()
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    this.applyVolume()
    this.ensureRunning()
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    this.applyVolume()
    if (this.volume === 0) this.stopTimer()
    else this.ensureRunning()
  }

  setTheme(theme: Theme): void {
    if (theme === this.theme) return
    this.theme = theme
    const ctx = this.ctx
    if (ctx === null) return
    const now = ctx.currentTime
    for (const name of ['main', 'void'] as Theme[]) {
      const bus = this.bus(name)
      const on = name === theme
      bus.gain.gain.cancelScheduledValues(now)
      bus.gain.gain.setValueAtTime(bus.gain.gain.value, now)
      bus.gain.gain.linearRampToValueAtTime(on ? 1 : 0, now + FADE_S)
      if (on && !bus.active) {
        bus.active = true
        bus.nextTime = now + 0.05
        if (name === 'void') bus.drone = this.startDrone(bus.gain)
      }
    }
    // The theme faded out stops making notes once it is silent.
    window.setTimeout(() => {
      for (const name of ['main', 'void'] as Theme[]) {
        if (name === this.theme) continue
        const bus = this.bus(name)
        bus.active = false
        bus.drone?.stop()
        bus.drone = undefined
      }
    }, FADE_S * 1000 + 100)
  }

  // Page hidden (app in the background): silence; shown again: carry on.
  setHidden(hidden: boolean): void {
    if (this.ctx === null) return
    if (hidden) void this.ctx.suspend()
    else if (this.volume > 0) void this.ctx.resume()
  }

  // ---------------------------------------------------------------------------------------------

  private build(): void {
    const ctx = this.ctx as AudioContext
    this.master = ctx.createGain()
    this.master.gain.value = 0
    // A soft low-passed feedback echo shared by both themes: the "room" the music sits in.
    const delay = ctx.createDelay(2)
    delay.delayTime.value = 0.42
    const feedback = ctx.createGain()
    feedback.gain.value = 0.38
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 2200
    this.echo = ctx.createGain()
    this.echo.gain.value = 0.35
    this.echo.connect(delay)
    delay.connect(tone)
    tone.connect(feedback)
    feedback.connect(delay)
    tone.connect(this.master)
    this.master.connect(ctx.destination)
    for (const name of ['main', 'void'] as Theme[]) {
      const bus = this.bus(name)
      bus.gain.gain.value = name === this.theme ? 1 : 0
      bus.active = name === this.theme
      bus.nextTime = ctx.currentTime + 0.1
      if (bus.active && name === 'void') bus.drone = this.startDrone(bus.gain)
    }
  }

  private bus(name: Theme): ThemeBus {
    const existing = this.buses[name]
    if (existing !== undefined) return existing
    const ctx = this.ctx as AudioContext
    const gain = ctx.createGain()
    gain.connect(this.master as GainNode)
    gain.connect(this.echo as GainNode)
    const bus: ThemeBus = { gain, active: false, nextTime: 0, step: 0 }
    this.buses[name] = bus
    return bus
  }

  private applyVolume(): void {
    if (this.ctx === null || this.master === null) return
    const now = this.ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(this.master.gain.value, now)
    this.master.gain.linearRampToValueAtTime(this.volume * 0.5, now + 0.3)
  }

  private ensureRunning(): void {
    if (this.timer !== undefined || this.ctx === null || this.volume === 0) return
    this.timer = window.setInterval(() => this.schedule(), TICK_MS)
  }

  private stopTimer(): void {
    window.clearInterval(this.timer)
    this.timer = undefined
  }

  private schedule(): void {
    const ctx = this.ctx
    if (ctx === null || ctx.state !== 'running') return
    const horizon = ctx.currentTime + LOOKAHEAD_S
    const main = this.buses.main
    if (main?.active) {
      // A long pause (tab in the background) skips ahead instead of playing a burst.
      if (main.nextTime < ctx.currentTime - 1) main.nextTime = ctx.currentTime + 0.05
      while (main.nextTime < horizon) {
        this.mainStep(main, main.nextTime)
        main.nextTime += MAIN_EIGHTH_S
        main.step++
      }
    }
    const voidBus = this.buses.void
    if (voidBus?.active) {
      if (voidBus.nextTime < ctx.currentTime - 1) voidBus.nextTime = ctx.currentTime + 0.05
      while (voidBus.nextTime < horizon) {
        this.voidEvent(voidBus, voidBus.nextTime)
        voidBus.nextTime += 1.2 + this.random() * 2.4
      }
    }
  }

  private mainStep(bus: ThemeBus, at: number): void {
    const inChord = bus.step % STEPS_PER_CHORD
    const chord = MAIN_CHORDS[Math.floor(bus.step / STEPS_PER_CHORD) % MAIN_CHORDS.length]
    if (inChord === 0) {
      // Pad: the chord, held for the whole two bars.
      const length = STEPS_PER_CHORD * MAIN_EIGHTH_S
      for (const note of chord) this.voice(bus.gain, midiHz(note + 12), at, length, 0.035, 'triangle', 0.9, length * 0.4)
    }
    if (inChord % 4 === 0) this.voice(bus.gain, midiHz(chord[0] - 12), at, MAIN_EIGHTH_S * 3.5, 0.11, 'sine', 0.02, 0.6)
    // Arpeggio: a chord tone an octave or two up, on most eighths.
    if (this.random() < 0.62) {
      const note = chord[Math.floor(this.random() * chord.length)] + (this.random() < 0.5 ? 24 : 36)
      this.voice(bus.gain, midiHz(note), at, MAIN_EIGHTH_S * 2, 0.045, 'sine', 0.008, 0.9)
    }
  }

  private voidEvent(bus: ThemeBus, at: number): void {
    // A bell: a sine with an inharmonic partial, long ringing decay.
    const note = VOID_BELLS[Math.floor(this.random() * VOID_BELLS.length)] - (this.random() < 0.4 ? 12 : 0)
    const hz = midiHz(note)
    this.voice(bus.gain, hz, at, 4, 0.06, 'sine', 0.005, 3.5)
    this.voice(bus.gain, hz * 2.76, at, 2, 0.015, 'sine', 0.005, 1.6)
  }

  // A low A / E drone that slowly swells and recedes; runs until stopped.
  private startDrone(out: GainNode): { stop: () => void } {
    const ctx = this.ctx as AudioContext
    const gain = ctx.createGain()
    gain.gain.value = 0.05
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const depth = ctx.createGain()
    depth.gain.value = 0.03
    lfo.connect(depth)
    depth.connect(gain.gain)
    const oscs = [midiHz(33), midiHz(33) * 1.004, midiHz(40)].map((hz) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = hz
      osc.connect(gain)
      osc.start()
      return osc
    })
    gain.connect(out)
    lfo.start()
    return {
      stop: () => {
        for (const osc of [...oscs, lfo]) {
          try {
            osc.stop()
          } catch {
            // already stopped
          }
        }
        gain.disconnect()
      },
    }
  }

  // One note: attack, hold, exponential release.
  private voice(out: GainNode, hz: number, at: number, length: number, level: number, type: OscillatorType, attack: number, release: number): void {
    const ctx = this.ctx as AudioContext
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = hz
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(level, at + attack)
    env.gain.setValueAtTime(level, at + Math.max(attack, length - release))
    env.gain.exponentialRampToValueAtTime(0.0001, at + length + release)
    osc.connect(env)
    env.connect(out)
    osc.start(at)
    osc.stop(at + length + release + 0.05)
    osc.onended = () => env.disconnect()
  }
}

// The app's one music player.
export const music = new MusicPlayer()
