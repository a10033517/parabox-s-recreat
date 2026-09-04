import { Board, Cell, Direction, World, step } from '../../src/game/engine/types'
import { applyMove } from '../../src/game/engine/rules'
import { inversePush } from './inverseMoves'

function makeBoard(id: string, size: number): Board {
  const cells: Cell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'floor' as const })),
  )
  return { id, size, cells }
}

function makeRootWorld(size: number): World {
  return {
    boards: { root: makeBoard('root', size) },
    pieces: { player: { id: 'player', kind: 'player' } },
    locations: { player: { board: 'root', x: 0, y: 0 } },
  }
}

test('inversePush reconstructs a plain walk with no pieces pushed', () => {
  const world = makeRootWorld(3)
  world.locations.player = { board: 'root', x: 1, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inversePush reconstructs a single-piece push', () => {
  const world = makeRootWorld(4)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inversePush reconstructs a two-piece chain push', () => {
  const world = makeRootWorld(5)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.pieces.box2 = { id: 'box2', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  world.locations.box2 = { board: 'root', x: 3, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})

test('inversePush returns null when a wall blocks the chain from landing', () => {
  const world = makeRootWorld(4)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  world.boards.root.cells[1][3] = { type: 'wall' }
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush returns null when the cell behind the player is occupied', () => {
  const world = makeRootWorld(4)
  world.pieces.blocker = { id: 'blocker', kind: 'normal' }
  world.locations.player = { board: 'root', x: 2, y: 1 }
  world.locations.blocker = { board: 'root', x: 1, y: 1 }
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush returns null when the chain runs off the edge of the board', () => {
  const world = makeRootWorld(4)
  world.pieces.box1 = { id: 'box1', kind: 'normal' }
  world.pieces.box2 = { id: 'box2', kind: 'normal' }
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.box1 = { board: 'root', x: 2, y: 1 }
  world.locations.box2 = { board: 'root', x: 3, y: 1 }
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush works in all four directions', () => {
  const directions: Direction[] = ['up', 'down', 'left', 'right']
  for (const dir of directions) {
    const world = makeRootWorld(5)
    world.pieces.box1 = { id: 'box1', kind: 'normal' }
    world.locations.player = { board: 'root', x: 2, y: 2 }
    const ahead = step(2, 2, dir)
    world.locations.box1 = { board: 'root', x: ahead.x, y: ahead.y }
    const prev = inversePush(world, dir)
    expect(prev, `direction ${dir}`).not.toBeNull()
    expect(applyMove(prev!, dir)).toEqual(world)
  }
})

test('inversePush returns null when a container in the chain is wall-blocked (needs eat, not push)', () => {
  const world = makeRootWorld(5)
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.boards.inside = makeBoard('inside', 3)
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.container1 = { board: 'root', x: 2, y: 1 }
  world.boards.root.cells[1][3] = { type: 'wall' }
  // Geometrically this still looks like "player -> container1 -> wall,"
  // which inversePush's own chain walk correctly rejects (the cell after
  // the chain is a wall, not open floor) before ever reaching
  // verifyPredecessor. The real engine resolves this via enter/eat instead
  // of a uniform push (see inverseEnter/inverseEat in Tasks 4-5), which is
  // exactly why a uniform-push candidate must not be accepted here.
  expect(inversePush(world, 'right')).toBeNull()
})

test('inversePush treats an unblocked container as an ordinary pushable piece', () => {
  const world = makeRootWorld(5)
  world.pieces.container1 = { id: 'container1', kind: 'container', boardRef: 'inside' }
  world.boards.inside = makeBoard('inside', 3)
  world.locations.player = { board: 'root', x: 1, y: 1 }
  world.locations.container1 = { board: 'root', x: 2, y: 1 }
  const prev = inversePush(world, 'right')
  expect(prev).not.toBeNull()
  expect(applyMove(prev!, 'right')).toEqual(world)
})
