import { describe, it, expect } from 'vitest'
import { applyMove, tryMovePiece } from './rules'
import { parseOfficialLevel } from './officialFormat'
import { makeFloorBoard, makeWorld, setWall } from './testFixtures'
import { PLAYER_ID, World, findContainerFor, hasInterior } from './types'

// The player can itself be a box (official: a `player=1` Block without fillwithwalls): it has
// an interior that other blocks can be eaten / pushed into, exactly like a container.

function playerBoxWorld(): World {
  // root 4x3; the player P (interior 'pIn', 3x3) at (0,1); a solid box N at (1,1); a wall at
  // (2,1) behind N, so N cannot be pushed.
  const root = makeFloorBoard('root', 4)
  setWall(root, 2, 1)
  return makeWorld(
    [root, makeFloorBoard('pIn', 3)],
    [
      { id: PLAYER_ID, kind: 'player', boardRef: 'pIn' },
      { id: 'N', kind: 'normal' },
    ],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, N: { board: 'root', x: 1, y: 1 } },
  )
}

describe('the player as a box', () => {
  it('has an interior and owns its board', () => {
    const world = playerBoxWorld()
    expect(hasInterior(world.pieces[PLAYER_ID])).toBe(true)
    expect(findContainerFor(world, 'pIn')).toBe(PLAYER_ID)
  })

  it('moving into a box that cannot be pushed eats it: the box enters the player from the side it was hit on', () => {
    const next = applyMove(playerBoxWorld(), 'right')!
    expect(next.locations[PLAYER_ID]).toEqual({ board: 'root', x: 1, y: 1 })
    // N enters the player moving left, so it comes in through the player's right edge.
    expect(next.locations.N).toEqual({ board: 'pIn', x: 2, y: 1 })
  })

  it('a solid player (no interior) still cannot eat: the move is blocked', () => {
    const world = playerBoxWorld()
    delete world.pieces[PLAYER_ID].boardRef
    delete world.boards.pIn
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('a wall at the player entry cell blocks the eat', () => {
    const world = playerBoxWorld()
    setWall(world.boards.pIn, 2, 1)
    expect(applyMove(world, 'right')).toBeNull()
  })

  it('a box inside the player is pushed out through the player, landing beside it on the outer board', () => {
    // N sits inside the player at its right edge; Q (also inside) pushes it right. N leaves the
    // player's interior and climbs out through the player's own position onto the outer board.
    const world = playerBoxWorld()
    world.locations.N = { board: 'pIn', x: 2, y: 1 }
    world.pieces.Q = { id: 'Q', kind: 'normal' }
    world.locations.Q = { board: 'pIn', x: 1, y: 1 }
    const moved = tryMovePiece(world, 'Q', 'right', new Map(), new Set())!
    expect(moved.locations.N).toEqual({ board: 'root', x: 1, y: 1 })
    expect(moved.locations.Q).toEqual({ board: 'pIn', x: 2, y: 1 })
  })
})

describe('official format: player Block without fillwithwalls is a box', () => {
  const T = '\t'
  const level = (fill: 0 | 1) => `version 4
#
Block -1 -1 0 5 5 0.6 0 0.8 1 0 0 0 0 0 0 0
${T}Block 1 2 1 3 3 0.9 1 0.7 1 ${fill} 1 1 0 0 0 0
${T}${T}Wall 0 0 0 0 0
`
  it('fillwithwalls=0: the player gets its own interior board, walls included', () => {
    const world = parseOfficialLevel(level(0))
    const player = world.pieces[PLAYER_ID]
    expect(player.boardRef).toBe('b1')
    expect(world.boards.b1.size).toBe(3)
    // file (0,0) is the bottom-left cell; the importer flips y, so it is engine (0,2).
    expect(world.boards.b1.cells[2][0].type).toBe('wall')
  })

  it('fillwithwalls=1: a solid player, no interior', () => {
    const world = parseOfficialLevel(level(1))
    expect(world.pieces[PLAYER_ID].boardRef).toBeUndefined()
    expect(world.boards.b1).toBeUndefined()
  })
})

describe('player_box_eat.txt (test level, 2026-09-25)', () => {
  it('eat the stuck box into yourself, then stand on the player goal: solved', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { checkWin } = await import('./rules')
    const text = readFileSync(join(__dirname, '../../../docs/differential/community-samples/player_box_eat.txt'), 'utf8')
    let w = parseOfficialLevel(text)
    for (const dir of ['right', 'right', 'right', 'down', 'down', 'left'] as const) {
      const next = applyMove(w, dir)
      expect(next, dir).not.toBeNull()
      w = next!
    }
    expect(w.locations.box2.board).toBe('b1')
    expect(checkWin(w)).toBe(true)
  })
})
