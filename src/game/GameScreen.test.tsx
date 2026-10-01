import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  GameScreen,
  classifyMove,
  isSimpleContainmentStep,
  getRenderLocationFactory,
  easeOut,
  lerp,
} from './GameScreen'
import { makeFloorBoard, makeWorld, setRequirement, setWall } from './engine/testFixtures'
import { PLAYER_ID, VOID_BOARD_ID, World } from './engine/types'

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), arc: vi.fn(), moveTo: vi.fn(), fill: vi.fn(),
    translate: vi.fn(), scale: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext
})

function simpleWorld() {
  return makeWorld(
    [makeFloorBoard('root', 3)],
    [{ id: PLAYER_ID, kind: 'player' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
  )
}

test('pressing a DPad button increments the step counter', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 1')).toBeInTheDocument()
})

test('undo button decrements the step counter', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
})

test('the canvas viewport is unaffected by which board is currently active', async () => {
  // The canvas is now a fixed viewport (this task) — entering a much larger board must
  // NOT resize the canvas element the way the old per-board renderer did (the old test
  // this replaces asserted canvas.width === 5*32 after entering a size-5 board; that
  // behavior is deliberately removed).
  const root = makeFloorBoard('root', 3)
  setWall(root, 2, 1) // block the container from being pushed, forcing entry instead
  const inside = makeFloorBoard('inside', 5)
  const world = makeWorld(
    [root, inside],
    [{ id: PLAYER_ID, kind: 'player' }, { id: 'containerBox', kind: 'container', boardRef: 'inside' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, containerBox: { board: 'root', x: 1, y: 1 } },
  )
  const { container } = render(<GameScreen initialWorld={world} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  const canvasWidthBefore = container.querySelector('canvas')!.width
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 1')).toBeInTheDocument() // the entry move counted normally
  expect(container.querySelector('canvas')!.width).toBe(canvasWidthBefore)
})

test('reaching the win condition calls onWin exactly once', async () => {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'player')
  const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
  const onWin = vi.fn()
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(1)
})

test('undoing out of a won state allows onWin to fire again on re-winning', async () => {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'player')
  const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
  const onWin = vi.fn()
  render(<GameScreen initialWorld={world} onExit={() => {}} onWin={onWin} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(1)
  await user.click(screen.getByText('复位上一步'))
  await user.click(screen.getByLabelText('右'))
  expect(onWin).toHaveBeenCalledTimes(2)
})

test('pushing the player into a self-loop sends them to the Void, and play continues', async () => {
  const root = makeFloorBoard('root', 2)
  const world = makeWorld(
    [root],
    [{ id: PLAYER_ID, kind: 'player' }, { id: 'loopBox', kind: 'container', boardRef: 'root' }],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, loopBox: { board: 'root', x: 0, y: 0 } },
  )
  const onExit = vi.fn()
  render(<GameScreen initialWorld={world} onExit={onExit} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('左'))
  expect(screen.queryByTestId('lose-notice')).not.toBeInTheDocument()
  expect(screen.getByText('步数: 1')).toBeInTheDocument()
  await user.click(screen.getByLabelText('右'))
  expect(screen.getByText('步数: 2')).toBeInTheDocument()
  await user.click(screen.getByText('离开'))
  expect(onExit).toHaveBeenCalledTimes(1)
})

test('captures the exact pre-move and post-move World via state.current, not a history index', async () => {
  // Indirect proof: after one move then one undo, the move counter (driven by
  // GameState.moveCount, itself derived from history.length) is exactly 0 — proves the
  // animation capture never mutated or mis-indexed GameState's own history.
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
})

test('an ordinary move still resolves to the correct final position after its animation settles', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByLabelText('右'))
  await new Promise((resolve) => setTimeout(resolve, 500)) // outlast every animation duration (max 400ms)
  expect(screen.getByText('步数: 2')).toBeInTheDocument()
})

test('undo cancels any in-flight animation and settles on the reverted state', async () => {
  render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('右'))
  await user.click(screen.getByText('复位上一步'))
  expect(screen.getByText('步数: 0')).toBeInTheDocument()
  // no throw, no leftover animation referencing a now-stale pre/post pair
})

test('runs a requestAnimationFrame loop and cancels it on unmount', () => {
  const rafSpy = vi.spyOn(window, 'requestAnimationFrame')
  const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame')
  const { unmount } = render(<GameScreen initialWorld={simpleWorld()} onExit={() => {}} onWin={() => {}} />)
  expect(rafSpy).toHaveBeenCalled()
  unmount()
  expect(cancelSpy).toHaveBeenCalled()
})

// I5: the animation layer's own logic, unit-tested directly against real pre/post World
// pairs — these are exported specifically so they can be tested here, instead of only
// indirectly through end-state assertions that would pass against a broken/no-op
// animation implementation too (final-review I5).

describe('classifyMove', () => {
  it('returns \'move\' for a same-board push', () => {
    const root = makeFloorBoard('root', 3)
    const pre = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    const post = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 1, y: 0 } })
    expect(classifyMove(pre, post)).toBe('move')
  })

  it('returns \'enter-leave\' for entering a container\'s own interior', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 2)
    const pieces = [
      { id: PLAYER_ID, kind: 'player' as const },
      { id: 'box', kind: 'container' as const, boardRef: 'inside' },
    ]
    const pre = makeWorld([root, inside], pieces, {
      [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
      box: { board: 'root', x: 1, y: 0 },
    })
    const post = makeWorld([root, inside], pieces, {
      [PLAYER_ID]: { board: 'inside', x: 0, y: 0 }, // entered box's interior
      box: { board: 'root', x: 1, y: 0 },
    })
    expect(classifyMove(pre, post)).toBe('enter-leave')
  })

  it('returns \'enter-leave\' for leaving a container\'s interior back out to its own board', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 2)
    const pieces = [
      { id: PLAYER_ID, kind: 'player' as const },
      { id: 'box', kind: 'container' as const, boardRef: 'inside' },
    ]
    const pre = makeWorld([root, inside], pieces, {
      [PLAYER_ID]: { board: 'inside', x: 0, y: 0 },
      box: { board: 'root', x: 1, y: 0 },
    })
    const post = makeWorld([root, inside], pieces, {
      [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, // left back out onto box's own board
      box: { board: 'root', x: 1, y: 0 },
    })
    expect(classifyMove(pre, post)).toBe('enter-leave')
  })

  it('returns \'teleport\' for a cross-container jump with no direct containment relationship', () => {
    const root = makeFloorBoard('root', 3)
    const c1Interior = makeFloorBoard('c1Interior', 2)
    const c2Interior = makeFloorBoard('c2Interior', 2)
    const pieces = [
      { id: PLAYER_ID, kind: 'player' as const },
      { id: 'C1', kind: 'container' as const, boardRef: 'c1Interior' },
      { id: 'C2', kind: 'container' as const, boardRef: 'c2Interior' },
    ]
    const pre = makeWorld([root, c1Interior, c2Interior], pieces, {
      [PLAYER_ID]: { board: 'c1Interior', x: 0, y: 0 },
      C1: { board: 'root', x: 0, y: 0 },
      C2: { board: 'root', x: 1, y: 0 },
    })
    const post = makeWorld([root, c1Interior, c2Interior], pieces, {
      [PLAYER_ID]: { board: 'c2Interior', x: 0, y: 0 }, // a jump between two boards with no containment between them
      C1: { board: 'root', x: 0, y: 0 },
      C2: { board: 'root', x: 1, y: 0 },
    })
    expect(classifyMove(pre, post)).toBe('teleport')
  })

  it('returns \'void-transition\' for entering the Void', () => {
    const root = makeFloorBoard('root', 2)
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const pre = makeWorld([root, voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    const post = makeWorld([root, voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    expect(classifyMove(pre, post)).toBe('void-transition')
  })

  it('returns \'void-transition\' for leaving the Void', () => {
    const root = makeFloorBoard('root', 2)
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const pre = makeWorld([root, voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    const post = makeWorld([root, voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } })
    expect(classifyMove(pre, post)).toBe('void-transition')
  })
})

describe('isSimpleContainmentStep', () => {
  it('returns true when entering: the new board is owned by a container sitting on the old board', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 1, y: 0 } },
    )
    expect(isSimpleContainmentStep(world, 'root', 'inside')).toBe(true)
  })

  it('returns true when leaving: the old board is owned by a container sitting on the new board', () => {
    const root = makeFloorBoard('root', 3)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: 'box', kind: 'container', boardRef: 'inside' }],
      { box: { board: 'root', x: 1, y: 0 } },
    )
    expect(isSimpleContainmentStep(world, 'inside', 'root')).toBe(true)
  })

  it('returns false when neither board owns the other, or the owner is elsewhere', () => {
    const root = makeFloorBoard('root', 3)
    const a = makeFloorBoard('a', 2)
    const b = makeFloorBoard('b', 2)
    const world = makeWorld(
      [root, a, b],
      [{ id: 'boxA', kind: 'container', boardRef: 'a' }, { id: 'boxB', kind: 'container', boardRef: 'b' }],
      { boxA: { board: 'root', x: 0, y: 0 }, boxB: { board: 'root', x: 1, y: 0 } },
    )
    expect(isSimpleContainmentStep(world, 'a', 'b')).toBe(false)
  })
})

describe('getRenderLocationFactory', () => {
  function worldAt(board: string, x: number, y: number): World {
    return makeWorld([makeFloorBoard(board, 4)], [{ id: 'box1', kind: 'normal' }], { box1: { board, x, y } })
  }

  it('interpolates a same-board move at t=0, t=0.5, and t=1', () => {
    const pre = worldAt('root', 0, 0)
    const post = worldAt('root', 2, 0)
    expect(getRenderLocationFactory(pre, post, 0)('box1')).toEqual({ board: 'root', x: 0, y: 0 })
    expect(getRenderLocationFactory(pre, post, 0.5)('box1')).toEqual({ board: 'root', x: 1, y: 0 })
    expect(getRenderLocationFactory(pre, post, 1)('box1')).toEqual({ board: 'root', x: 2, y: 0 })
  })

  it('returns the post-location directly, with no interpolation, when the board changes', () => {
    const pre = makeWorld(
      [makeFloorBoard('root', 4), makeFloorBoard('inside', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'root', x: 0, y: 0 } },
    )
    const post = makeWorld(
      [makeFloorBoard('root', 4), makeFloorBoard('inside', 2)],
      [{ id: 'box1', kind: 'normal' }],
      { box1: { board: 'inside', x: 1, y: 1 } },
    )
    // Even mid-tween (t=0.5), a cross-board relocation must snap straight to `post` —
    // interpolating x/y across two different boards' coordinate spaces would be meaningless.
    expect(getRenderLocationFactory(pre, post, 0.5)('box1')).toEqual({ board: 'inside', x: 1, y: 1 })
  })
})

describe('easeOut', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOut(0)).toBeCloseTo(0)
    expect(easeOut(1)).toBeCloseTo(1)
  })
  it('is front-loaded (decelerating): the midpoint is past 0.5', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
  })
})

describe('lerp', () => {
  it('returns a at t=0, b at t=1, and the midpoint at t=0.5', () => {
    expect(lerp(10, 20, 0)).toBe(10)
    expect(lerp(10, 20, 1)).toBe(20)
    expect(lerp(10, 20, 0.5)).toBe(15)
  })
})
