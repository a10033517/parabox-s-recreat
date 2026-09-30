import { describe, it, expect } from 'vitest'
import { parseLevel, serializeLevel } from '../game/engine/levelSchema'
import { PLAYER_ID, World } from '../game/engine/types'
import { EditError, deletePiece, movePlayer, newLevel, paintCell, placePiece, resizeBoard, toggleGoal, updatePiece } from './editOps'
import { applyTool } from './tools'

const ok = (r: World | EditError): World => {
  if (r instanceof EditError) throw r
  return r
}
const valid = (w: World) => parseLevel(JSON.parse(JSON.stringify(serializeLevel(w))))

describe('level editor edit operations', () => {
  it('never modifies the world it is given', () => {
    const w = newLevel(5, { walled: true })
    const before = JSON.stringify(w)
    paintCell(w, 'root', 2, 2, 'wall', 'root')
    toggleGoal(w, 'root', 2, 2, 'box')
    expect(JSON.stringify(w)).toBe(before)
  })

  it('a box inside a box gets its own room, and deleting the box removes the room and its contents', () => {
    let w = newLevel(5)
    w = ok(placePiece(w, 'root', 2, 2, { id: 'c', kind: 'container', boardRef: 'room1' }, 'root', 4))
    expect(w.boards.room1.size).toBe(4)
    w = ok(placePiece(w, 'room1', 1, 1, { id: 'inner', kind: 'normal' }, 'root'))
    w = ok(deletePiece(w, 'c', 'root'))
    expect(w.boards.room1).toBeUndefined()
    expect(w.pieces.inner).toBeUndefined()
    expect(() => valid(w)).not.toThrow()
  })

  it('a room still reached through another box survives deleting one of its boxes', () => {
    let w = newLevel(5)
    w = ok(placePiece(w, 'root', 1, 1, { id: 'a', kind: 'container', boardRef: 'room1' }, 'root'))
    w = ok(placePiece(w, 'root', 3, 3, { id: 'b', kind: 'container', boardRef: 'room1' }, 'root'))
    w = ok(deletePiece(w, 'a', 'root'))
    expect(w.boards.room1).toBeDefined()
  })

  it('refuses edits that would delete the player', () => {
    let w = newLevel(5)
    w = ok(placePiece(w, 'root', 2, 2, { id: 'c', kind: 'container', boardRef: 'room1' }, 'root'))
    w = ok(movePlayer(w, 'room1', 0, 0, 'root'))
    expect(deletePiece(w, 'c', 'root')).toBeInstanceOf(EditError)
    expect(deletePiece(w, PLAYER_ID, 'root')).toBeInstanceOf(EditError)
    expect(resizeBoard(ok(movePlayer(newLevel(5), 'root', 4, 4, 'root')), 'root', 3, 'root')).toBeInstanceOf(EditError)
  })

  it('a wall painted over a goal clears the goal (a wall cannot hold one)', () => {
    let w = ok(toggleGoal(newLevel(4), 'root', 1, 1, 'box'))
    w = ok(paintCell(w, 'root', 1, 1, 'wall', 'root'))
    expect(w.boards.root.cells[1][1]).toEqual({ type: 'wall' })
  })

  it('resizing keeps the top-left and drops pieces outside', () => {
    let w = ok(placePiece(newLevel(6), 'root', 5, 5, { id: 'b', kind: 'normal' }, 'root'))
    w = ok(resizeBoard(w, 'root', 4, 'root'))
    expect(w.boards.root.size).toBe(4)
    expect(w.pieces.b).toBeUndefined()
  })

  it('the player can become a box, and every tool produces a valid level', () => {
    let w = newLevel(7, { walled: true })
    w = ok(updatePiece(w, PLAYER_ID, { boardRef: 'room9' }, 'root'))
    expect(w.boards.room9).toBeDefined()
    const opts = { containerSize: 3, referenceBoard: 'root', infinityDegree: 1 }
    const tools = ['box', 'box-possessable', 'wall-block', 'container', 'self-loop', 'reference', 'infinity'] as const
    tools.forEach((tool, i) => { w = ok(applyTool(w, tool, 'root', 1 + (i % 5), 2 + Math.floor(i / 5) * 2, opts, 'root') as World) })
    w = ok(applyTool(w, 'goal-player', 'root', 5, 5, opts, 'root') as World)
    expect(() => valid(w)).not.toThrow()
    expect(Object.values(w.pieces).some((p) => p.infExit && p.infExitNum === 1)).toBe(true)
  })
})
