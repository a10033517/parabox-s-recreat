import { render, screen, fireEvent } from '@testing-library/react'
import { SwipeLayer } from './SwipeLayer'

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }] }
}

test('a horizontal swipe calls onMove with left/right', () => {
  const onMove = vi.fn()
  render(
    <SwipeLayer onMove={onMove}>
      <div>content</div>
    </SwipeLayer>,
  )
  const el = screen.getByTestId('swipe-layer')
  fireEvent.touchStart(el, touch(100, 100))
  fireEvent.touchEnd(el, touch(200, 105))
  expect(onMove).toHaveBeenCalledWith('right')
})

test('a vertical swipe calls onMove with up/down', () => {
  const onMove = vi.fn()
  render(
    <SwipeLayer onMove={onMove}>
      <div>content</div>
    </SwipeLayer>,
  )
  const el = screen.getByTestId('swipe-layer')
  fireEvent.touchStart(el, touch(100, 100))
  fireEvent.touchEnd(el, touch(95, 30))
  expect(onMove).toHaveBeenCalledWith('up')
})

test('a short movement below the threshold does not trigger a move', () => {
  const onMove = vi.fn()
  render(
    <SwipeLayer onMove={onMove}>
      <div>content</div>
    </SwipeLayer>,
  )
  const el = screen.getByTestId('swipe-layer')
  fireEvent.touchStart(el, touch(100, 100))
  fireEvent.touchEnd(el, touch(105, 102))
  expect(onMove).not.toHaveBeenCalled()
})

describe('control settings', () => {
  const base = { controls: 'swipe' as const, swipeArea: 'screen' as const, swipeTrigger: 'move' as const, dragSteps: true, holdRepeat: false, sensitivity: 'medium' as const, haptics: false, tapToInspect: true }

  it('"move" trigger with drag: a long drag steps several times before the finger lifts', () => {
    const onMove = vi.fn()
    render(<SwipeLayer onMove={onMove} settings={base}><div>content</div></SwipeLayer>)
    const el = screen.getByTestId('swipe-layer')
    fireEvent.touchStart(el, touch(0, 0))
    fireEvent.touchMove(el, touch(90, 0))
    expect(onMove.mock.calls.map((c) => c[0])).toEqual(['right', 'right', 'right'])
    fireEvent.touchEnd(el, touch(90, 0))
    expect(onMove).toHaveBeenCalledTimes(3)
  })

  it('D-pad only: swipes do nothing', () => {
    const onMove = vi.fn()
    render(<SwipeLayer onMove={onMove} settings={{ ...base, controls: 'dpad' }}><div>content</div></SwipeLayer>)
    const el = screen.getByTestId('swipe-layer')
    fireEvent.touchStart(el, touch(0, 0))
    fireEvent.touchMove(el, touch(200, 0))
    fireEvent.touchEnd(el, touch(200, 0))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('tap mode: a tap on the left part of the area moves left; a swipe does nothing', () => {
    const onMove = vi.fn()
    render(<SwipeLayer onMove={onMove} settings={{ ...base, controls: 'tap' }}><div>content</div></SwipeLayer>)
    const el = screen.getByTestId('swipe-layer')
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.touchStart(el, touch(10, 200))
    fireEvent.touchEnd(el, touch(12, 201))
    expect(onMove).toHaveBeenCalledWith('left')
    fireEvent.touchStart(el, touch(100, 100))
    fireEvent.touchMove(el, touch(300, 100))
    fireEvent.touchEnd(el, touch(300, 100))
    expect(onMove).toHaveBeenCalledTimes(1)
  })

  it('touches that start on a button are left to the button', () => {
    const onMove = vi.fn()
    render(<SwipeLayer onMove={onMove} settings={base}><button>undo</button></SwipeLayer>)
    const button = screen.getByText('undo')
    fireEvent.touchStart(button, touch(0, 0))
    fireEvent.touchEnd(button, touch(200, 0))
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe('tap and long press (look inside a box)', () => {
  const base = { controls: 'swipe' as const, swipeArea: 'screen' as const, swipeTrigger: 'move' as const, dragSteps: true, holdRepeat: false, sensitivity: 'medium' as const, haptics: false, tapToInspect: true }

  it('swipe mode: a tap is reported (not a move)', () => {
    const onMove = vi.fn()
    const onTap = vi.fn()
    render(<SwipeLayer onMove={onMove} onTap={onTap} settings={base}><div>content</div></SwipeLayer>)
    const el = screen.getByTestId('swipe-layer')
    fireEvent.touchStart(el, touch(50, 60))
    fireEvent.touchEnd(el, touch(52, 61))
    expect(onTap).toHaveBeenCalledWith(52, 61)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('a finger held still is a long press, and lifting it afterwards does nothing more', () => {
    vi.useFakeTimers()
    const onMove = vi.fn()
    const onTap = vi.fn()
    const onLongPress = vi.fn()
    render(<SwipeLayer onMove={onMove} onTap={onTap} onLongPress={onLongPress} settings={{ ...base, controls: 'tap' }}><div>content</div></SwipeLayer>)
    const el = screen.getByTestId('swipe-layer')
    fireEvent.touchStart(el, touch(50, 60))
    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalledWith(50, 60)
    fireEvent.touchEnd(el, touch(50, 60))
    expect(onMove).not.toHaveBeenCalled() // tap mode would otherwise have moved
    expect(onTap).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('a swipe is never a long press', () => {
    vi.useFakeTimers()
    const onLongPress = vi.fn()
    render(<SwipeLayer onMove={vi.fn()} onLongPress={onLongPress} settings={base}><div>content</div></SwipeLayer>)
    const el = screen.getByTestId('swipe-layer')
    fireEvent.touchStart(el, touch(0, 0))
    fireEvent.touchMove(el, touch(60, 0))
    vi.advanceTimersByTime(800)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
