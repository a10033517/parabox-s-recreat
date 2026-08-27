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
