import { ReactNode, useEffect, useRef } from 'react'
import { Direction } from '../game/engine/types'
import { SWIPE_THRESHOLD_PX, Settings, defaultSettings } from '../storage/settings'
import { SwipeTracker, tapDirection } from './gesture'

const HOLD_DELAY_MS = 320 // finger held still after a step: start repeating
const HOLD_INTERVAL_MS = 150
const LONG_PRESS_MS = 450 // finger held still this long: a long press

// The area that turns finger (or mouse-drag) gestures into moves, per the player's control
// settings: swipe (optionally dragging for several steps, or holding to keep going) or tap on a
// side of the area. Touches that start on a button are left to the button.
export function SwipeLayer({
  onMove,
  children,
  settings = defaultSettings(),
  className,
  onTap,
  onLongPress,
  disabled = false,
}: {
  onMove: (direction: Direction) => void
  children: ReactNode
  settings?: Settings
  className?: string
  // A tap that is not a move (any mode but tap-to-move), and a long press / double click (every
  // mode) — at client coordinates. Used to look inside a box.
  onTap?: (x: number, y: number) => void
  onLongPress?: (x: number, y: number) => void
  // Ignore every gesture (the element itself stays, so what is inside is never re-created).
  disabled?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const tracker = useRef<SwipeTracker | null>(null)
  const hold = useRef<{ timer?: number; interval?: number; dir?: Direction }>({})
  // Touchscreens fire emulated mouse events right after a touch: ignore those.
  const lastTouch = useRef(0)
  const mouseAllowed = () => Date.now() - lastTouch.current > 800
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove
  const press = useRef<{ timer?: number; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false })
  const stopPress = () => window.clearTimeout(press.current.timer)

  const swipes = settings.controls !== 'dpad' && settings.controls !== 'tap'
  const taps = settings.controls === 'tap'
  const config = { threshold: SWIPE_THRESHOLD_PX[settings.sensitivity], trigger: settings.swipeTrigger, dragSteps: settings.dragSteps }

  const stopHold = () => {
    window.clearTimeout(hold.current.timer)
    window.clearInterval(hold.current.interval)
    hold.current = {}
  }
  useEffect(() => () => { stopHold(); stopPress() }, [])

  const step = (dir: Direction) => {
    onMoveRef.current(dir)
    if (!settings.holdRepeat) return
    // Each new step restarts the wait; holding still afterwards keeps moving this way.
    stopHold()
    hold.current.dir = dir
    hold.current.timer = window.setTimeout(() => {
      hold.current.interval = window.setInterval(() => onMoveRef.current(dir), HOLD_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  const onButton = (target: EventTarget | null) => target instanceof Element && target.closest('button, input, select, a, [role="dialog"]') !== null

  const begin = (x: number, y: number, target: EventTarget | null) => {
    if (disabled || onButton(target)) return
    tracker.current = new SwipeTracker(config)
    tracker.current.begin(x, y)
    stopPress()
    press.current = { x, y, fired: false }
    if (onLongPress !== undefined) {
      press.current.timer = window.setTimeout(() => {
        if (tracker.current === null) return
        press.current.fired = true
        tracker.current.cancel()
        tracker.current = null
        stopHold()
        onLongPress(press.current.x, press.current.y)
      }, LONG_PRESS_MS)
    }
  }
  const move = (x: number, y: number) => {
    const t = tracker.current
    if (t === null) return
    // Moving away is a swipe, not a long press.
    if (Math.max(Math.abs(x - press.current.x), Math.abs(y - press.current.y)) >= config.threshold) stopPress()
    if (!swipes) return
    const dirs = t.move(x, y)
    if (dirs.length > 0) stopPress()
    for (const dir of dirs) step(dir)
  }
  const end = (x: number, y: number) => {
    const t = tracker.current
    tracker.current = null
    stopHold()
    stopPress()
    if (t === null || press.current.fired) return
    const result = t.end(x, y)
    if (result === 'tap') {
      if (taps && ref.current) onMoveRef.current(tapDirection(x, y, ref.current.getBoundingClientRect()))
      else onTap?.(x, y)
    } else if (result !== null && swipes) {
      onMoveRef.current(result)
    }
  }
  const cancel = () => {
    tracker.current?.cancel()
    tracker.current = null
    stopHold()
    stopPress()
  }

  return (
    <div
      ref={ref}
      data-testid="swipe-layer"
      className={className}
      onTouchStart={(e) => { lastTouch.current = Date.now(); begin(e.touches[0].clientX, e.touches[0].clientY, e.target) }}
      onTouchMove={(e) => move(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchEnd={(e) => {
        lastTouch.current = Date.now()
        const t = e.changedTouches[0] ?? e.touches[0]
        end(t.clientX, t.clientY)
      }}
      onTouchCancel={cancel}
      // Mouse drag works the same way (desktop browsers, the level editor's play-test).
      onMouseDown={(e) => { if (e.button === 0 && mouseAllowed()) begin(e.clientX, e.clientY, e.target) }}
      onMouseMove={(e) => { if (tracker.current !== null && mouseAllowed()) move(e.clientX, e.clientY) }}
      onMouseUp={(e) => { if (mouseAllowed()) end(e.clientX, e.clientY) }}
      onMouseLeave={() => { if (mouseAllowed()) cancel() }}
      onDoubleClick={(e) => { if (!disabled && !onButton(e.target)) onLongPress?.(e.clientX, e.clientY) }}
    >
      {children}
    </div>
  )
}
