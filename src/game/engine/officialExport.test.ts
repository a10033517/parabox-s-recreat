import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseOfficialLevel } from './officialFormat'
import { exportOfficialLevel, hexToHsv } from './officialExport'
import { World } from './types'
import { makeFloorBoard, makeWorld } from './testFixtures'
import { PLAYER_ID } from './types'

const DIR = join(__dirname, '../../../docs/differential/community-samples')

// A World described without piece ids (which the format does not keep): every board's cells,
// and the multiset of pieces on it with everything else they carry.
function signature(world: World) {
  const boards = Object.values(world.boards).map((b) => ({ id: b.id, size: b.size, color: b.color, float: b.floatInSpace ?? false, cells: JSON.stringify(b.cells) }))
  const pieces = Object.values(world.pieces).map((p) => {
    const l = world.locations[p.id]
    return JSON.stringify({
      at: `${l.board}:${l.x},${l.y}`, kind: p.kind, boardRef: p.boardRef, color: p.color,
      fliph: p.fliph ?? false, possessable: p.possessable ?? false, wall: p.wall ?? false,
      exitBlock: p.exitBlock ?? false, infExit: p.infExit ?? false, infExitNum: p.infExit ? p.infExitNum : undefined,
      infEnter: p.infEnter ?? false,
    })
  })
  return { boards: boards.sort((a, b) => a.id.localeCompare(b.id)), pieces: pieces.sort(), attemptOrder: world.attemptOrder }
}

describe('exportOfficialLevel round trip (import -> export -> import)', () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.txt'))) {
    it(file, () => {
      const first = parseOfficialLevel(readFileSync(join(DIR, file), 'utf8'))
      const { text } = exportOfficialLevel(first)
      const second = parseOfficialLevel(text)
      expect(signature(second)).toEqual(signature(first))
    })
  }
})

describe('exportOfficialLevel', () => {
  it('writes an engine-made level (no official ids) that the importer reads back', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 5), makeFloorBoard('inside', 3)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'box', kind: 'container', boardRef: 'inside', color: '#3d9bff' },
        { id: 'loop', kind: 'container', boardRef: 'root', exitBlock: true },
        { id: 'solid', kind: 'normal', possessable: true },
      ],
      { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 2 }, loop: { board: 'root', x: 4, y: 4 }, solid: { board: 'inside', x: 1, y: 1 } },
    )
    world.boards.root.cells[0][4] = { type: 'floor', requirement: 'player' }
    const back = parseOfficialLevel(exportOfficialLevel(world).text)
    expect(Object.keys(back.boards)).toHaveLength(2)
    expect(Object.values(back.pieces).filter((p) => p.kind === 'container')).toHaveLength(2)
    expect(Object.values(back.pieces).some((p) => p.possessable && p.kind === 'normal')).toBe(true)
    expect(back.locations[PLAYER_ID]).toEqual({ board: expect.any(String), x: 0, y: 0 })
  })

  it('hexToHsv inverts the importer colours', () => {
    const [h, s, v] = hexToHsv('#ff0000')
    expect([h, s, v]).toEqual([0, 1, 1])
  })
})
