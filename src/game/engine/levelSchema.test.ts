import { describe, it, expect } from 'vitest'
import { serializeLevel, parseLevel } from './levelSchema'
import { makeFloorBoard, makeWorld, setRequirement } from './testFixtures'
import { PLAYER_ID, World } from './types'

function sampleWorld(): World {
  const root = makeFloorBoard('root', 2)
  setRequirement(root, 1, 0, 'box')
  const inside = makeFloorBoard('inside', 1)
  return makeWorld(
    [root, inside],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'box1', kind: 'container', boardRef: 'inside' },
    ],
    {
      [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
      box1: { board: 'root', x: 1, y: 0 },
    },
  )
}

describe('serializeLevel / parseLevel round trip', () => {
  it('produces a world equal to the original after serializing and parsing', () => {
    const world = sampleWorld()
    const parsed = parseLevel(serializeLevel(world))
    expect(parsed).toEqual(world)
  })
})

describe('parseLevel structural validation', () => {
  it('rejects data that is not an object', () => {
    expect(() => parseLevel(null)).toThrow()
    expect(() => parseLevel('nope')).toThrow()
  })

  it('rejects a level with no player piece', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, unknown> }
    delete data.pieces[PLAYER_ID]
    expect(() => parseLevel(data)).toThrow(/player/i)
  })

  it('rejects a level with more than one player piece', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, unknown> }
    data.pieces.player2 = { id: 'player2', kind: 'player' }
    expect(() => parseLevel(data)).toThrow(/player/i)
  })

  it('rejects a non-square board', () => {
    const data = serializeLevel(sampleWorld()) as { boards: Record<string, { cells: unknown[] }> }
    data.boards.root.cells.push([{ type: 'floor' }, { type: 'floor' }]) // 3 rows for a declared size of 2
    expect(() => parseLevel(data)).toThrow(/square/i)
  })

  it('rejects a container piece whose boardRef does not exist', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, { boardRef?: string }> }
    data.pieces.box1.boardRef = 'missingBoard'
    expect(() => parseLevel(data)).toThrow(/boardRef/i)
  })

  it('rejects a location that points at a board that does not exist', () => {
    const data = serializeLevel(sampleWorld()) as { locations: Record<string, { board: string }> }
    data.locations.box1.board = 'missingBoard'
    expect(() => parseLevel(data)).toThrow(/board/i)
  })

  it('rejects a location out of bounds for its board', () => {
    const data = serializeLevel(sampleWorld()) as { locations: Record<string, { x: number }> }
    data.locations.box1.x = 99
    expect(() => parseLevel(data)).toThrow(/bounds/i)
  })

  it('rejects a piece with no matching location', () => {
    const data = serializeLevel(sampleWorld()) as { locations: Record<string, unknown> }
    delete data.locations.box1
    expect(() => parseLevel(data)).toThrow(/location/i)
  })

  it('rejects two pieces sharing the same location', () => {
    const data = serializeLevel(sampleWorld()) as {
      pieces: Record<string, unknown>
      locations: Record<string, { board: string; x: number; y: number }>
    }
    data.pieces.box2 = { id: 'box2', kind: 'normal' }
    data.locations.box2 = { ...data.locations.box1 }
    expect(() => parseLevel(data)).toThrow(/occupy/i)
  })

  it('rejects a piece with an invalid kind', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, { kind: string }> }
    data.pieces.box1.kind = 'ghost'
    expect(() => parseLevel(data)).toThrow(/kind/i)
  })

  it('rejects a non-container piece that has a boardRef', () => {
    const data = serializeLevel(sampleWorld()) as { pieces: Record<string, unknown> }
    data.pieces[PLAYER_ID] = { id: PLAYER_ID, kind: 'player', boardRef: 'inside' }
    expect(() => parseLevel(data)).toThrow(/boardRef/i)
  })

  it('rejects a board with a cell of an invalid type', () => {
    const data = serializeLevel(sampleWorld()) as { boards: Record<string, { cells: { type: string }[][] }> }
    data.boards.root.cells[0][0].type = 'lava'
    expect(() => parseLevel(data)).toThrow(/type/i)
  })

  it('rejects a cell with an invalid requirement value', () => {
    const data = serializeLevel(sampleWorld()) as { boards: Record<string, { cells: { requirement?: string }[][] }> }
    data.boards.root.cells[0][0].requirement = 'nonsense'
    expect(() => parseLevel(data)).toThrow(/requirement/i)
  })

  it('rejects an authored board using the reserved void board id', () => {
    const data = serializeLevel(makeWorld(
      [makeFloorBoard('void', 2)],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'void', x: 0, y: 0 } },
    ))
    expect(() => parseLevel(data)).toThrow(/reserved/i)
  })

  it('rejects a requirement placed on a wall cell', () => {
    const data = serializeLevel(sampleWorld()) as {
      boards: Record<string, { cells: { type: string; requirement?: string }[][] }>
    }
    data.boards.root.cells[0][0].type = 'wall'
    data.boards.root.cells[0][0].requirement = 'box'
    expect(() => parseLevel(data)).toThrow(/wall/i)
  })
})

describe('parseLevel board-ownership validation', () => {
  it('rejects two containers referencing the same board', () => {
    const data = serializeLevel(sampleWorld()) as {
      pieces: Record<string, unknown>
    }
    data.pieces.box2 = { id: 'box2', kind: 'container', boardRef: 'inside' }
    expect(() => parseLevel(data)).toThrow(/owner/i)
  })

  it('rejects a non-root board referenced by zero containers', () => {
    const data = serializeLevel(sampleWorld()) as {
      boards: Record<string, unknown>
      locations: Record<string, unknown>
    }
    data.boards.orphan = makeFloorBoard('orphan', 1)
    // no piece references 'orphan', and it isn't 'root' — invalid
    expect(() => parseLevel(data)).toThrow(/owner/i)
  })

  it('rejects a self-referencing container on a non-root board with no external owner', () => {
    // cx self-references board x (its own interior is the very board it
    // sits on). Self-references now count as ordinary owners (see
    // levelSchema.ts), so x has exactly one owner (itself) — it's root that
    // stays the sole orphan board. But nothing on root (or anywhere reached
    // from root) ever references x, so x is simply never reached by the
    // walk from root: still invalid, just caught by reachability instead of
    // by the ownership count.
    const root = makeFloorBoard('root', 2)
    const x = makeFloorBoard('x', 2)
    const world = makeWorld(
      [root, x],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'cx', kind: 'container', boardRef: 'x' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        cx: { board: 'x', x: 0, y: 0 }, // cx sits inside its own interior
      },
    )
    const data = serializeLevel(world)
    expect(() => parseLevel(data)).toThrow(/reachable/i)
  })

  it('accepts a self-referencing container on the root board', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        loopBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const data = serializeLevel(world)
    expect(parseLevel(data)).toEqual(world)
  })

  it('rejects a self-referencing container that shares a board with a separate external owner', () => {
    // Once self-references count normally, board y has TWO owners here — d
    // (external, on root) and loopBox (self-referencing y itself) — which
    // is exactly as invalid as any other over-owned board. This is the
    // shape that made the shipped self-loop box permanently inert whenever
    // it coexisted with a real external owner: see the spec's Background.
    const root = makeFloorBoard('root', 2)
    const y = makeFloorBoard('y', 2)
    const world = makeWorld(
      [root, y],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'd', kind: 'container', boardRef: 'y' }, // external owner, sits on root
        { id: 'loopBox', kind: 'container', boardRef: 'y' }, // self-reference, sits on y itself
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        d: { board: 'root', x: 1, y: 0 },
        loopBox: { board: 'y', x: 0, y: 0 },
      },
    )
    const data = serializeLevel(world)
    expect(() => parseLevel(data)).toThrow(/owner/i)
  })

  it('rejects a mutual two-board containment cycle', () => {
    const root = makeFloorBoard('root', 2)
    const a = makeFloorBoard('a', 2)
    const b = makeFloorBoard('b', 2)
    const world = makeWorld(
      [root, a, b],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'ca', kind: 'container', boardRef: 'a' }, // ca's interior is board a
        { id: 'cb', kind: 'container', boardRef: 'b' }, // cb's interior is board b
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        ca: { board: 'b', x: 0, y: 0 }, // ca is located ON board b
        cb: { board: 'a', x: 0, y: 0 }, // cb is located ON board a
      },
    )
    const data = serializeLevel(world)
    expect(() => parseLevel(data)).toThrow(/reachable/i)
  })

  it('accepts a two-node cycle that closes back through the starting board', () => {
    // redPiece owns redInterior; yellowPiece (inside redInterior) owns
    // root, closing the loop. Neither board has zero owners, so this is
    // the "cycle" branch: reachability is seeded from the player's board
    // (root) instead of an orphan.
    const root = makeFloorBoard('root', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [root, redInterior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        redPiece: { board: 'root', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
      },
    )
    const data = serializeLevel(world)
    expect(parseLevel(data)).toEqual(world)
  })

  it('accepts a cycle with a tree branch hanging off one node, when the player starts on the branch', () => {
    // redPiece owns redInterior; yellowPiece (inside redInterior) owns root,
    // closing a two-node cycle exactly like the test above. branchPiece
    // sits on root (a member of the cycle) but is not itself part of the
    // cycle — it owns an ordinary tree-branch board, branchBoard, where the
    // player starts. Reachability must walk UP out of branchBoard into root
    // (the board branchPiece sits on) to find the cycle at all; a directed
    // walk that only follows boardRef "down" can never climb back out of
    // branchBoard, and would wrongly reject this level as disconnected.
    const root = makeFloorBoard('root', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const branchBoard = makeFloorBoard('branchBoard', 1)
    const world = makeWorld(
      [root, redInterior, branchBoard],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'root' },
        { id: 'branchPiece', kind: 'container', boardRef: 'branchBoard' },
      ],
      {
        [PLAYER_ID]: { board: 'branchBoard', x: 0, y: 0 },
        redPiece: { board: 'root', x: 1, y: 0 },
        yellowPiece: { board: 'redInterior', x: 0, y: 0 },
        branchPiece: { board: 'root', x: 0, y: 1 },
      },
    )
    const data = serializeLevel(world)
    expect(parseLevel(data)).toEqual(world)
  })

  it('rejects two boards that both have no owner', () => {
    const root = makeFloorBoard('root', 2)
    const orphan = makeFloorBoard('orphan', 1)
    const world = makeWorld(
      [root, orphan],
      [{ id: PLAYER_ID, kind: 'player' }],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 } },
    )
    const data = serializeLevel(world)
    expect(() => parseLevel(data)).toThrow(/no owner/i)
  })

  it('rejects a cycle world whose player has no location, before reachability ever runs', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        loopBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const data = serializeLevel(world) as { locations: Record<string, unknown> }
    delete data.locations[PLAYER_ID]
    expect(() => parseLevel(data)).toThrow(/starting board/i)
  })

  it('rejects a cycle world whose player location points at a nonexistent board', () => {
    const root = makeFloorBoard('root', 2)
    const world = makeWorld(
      [root],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'loopBox', kind: 'container', boardRef: 'root' },
      ],
      {
        [PLAYER_ID]: { board: 'root', x: 0, y: 0 },
        loopBox: { board: 'root', x: 1, y: 0 },
      },
    )
    const data = serializeLevel(world) as { locations: Record<string, { board: string }> }
    data.locations[PLAYER_ID].board = 'nonexistent'
    expect(() => parseLevel(data)).toThrow(/starting board/i)
  })
})
