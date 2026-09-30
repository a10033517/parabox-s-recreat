import { describe, it, expect } from 'vitest'
import { classifyEpsilonVisuals, epsilonSpawnScale } from './epsilonAnimation'
import { applyMove } from '../engine/rules'
import { GameState } from '../engine/GameState'
import { makeFloorBoard, makeWorld, setWall } from '../engine/testFixtures'
import { PLAYER_ID, World } from '../engine/types'
import { drawBoardRecursive, DEFAULT_RENDER_BUDGET, indexPiecesByBoard } from './CanvasRenderer'

function loopWorld(): World {
  const root = makeFloorBoard('root', 3)
  setWall(root, 2, 1)
  const a = makeFloorBoard('a', 3)
  setWall(a, 1, 1)
  return makeWorld(
    [root, a],
    [
      { id: PLAYER_ID, kind: 'player' },
      { id: 'A', kind: 'container', boardRef: 'a' },
      { id: 'O', kind: 'container', cloneOf: 'A' },
    ],
    { [PLAYER_ID]: { board: 'root', x: 0, y: 1 }, A: { board: 'root', x: 1, y: 1 }, O: { board: 'a', x: 0, y: 1 } },
  )
}

describe('epsilonSpawnScale', () => {
  it('starts hidden, ends at exactly 1, and never decreases', () => {
    expect(epsilonSpawnScale(-1)).toBe(0)
    expect(epsilonSpawnScale(0)).toBe(0)
    expect(epsilonSpawnScale(1)).toBe(1)
    expect(epsilonSpawnScale(2)).toBe(1)
    let last = 0
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const s = epsilonSpawnScale(p)
      expect(s).toBeGreaterThanOrEqual(last)
      last = s
    }
  })

  it('passes through the 0.2 -> 0.6 -> 1.0 stages', () => {
    expect(epsilonSpawnScale(0.4)).toBeCloseTo(0.2)
    expect(epsilonSpawnScale(0.7)).toBeCloseTo(0.6)
  })
})

describe('classifyEpsilonVisuals (Spawn / Active / Remove)', () => {
  it('a move that CREATES an ε marks exactly that ε as Spawn', () => {
    const state = new GameState(loopWorld())
    const pre = state.current
    state.move('right')
    const visuals = classifyEpsilonVisuals(pre, state.current, state.lastEvents)
    expect([...visuals.values()]).toEqual(['Spawn'])
  })

  it('the event is one-shot: the next move sees the same ε as Active, not Spawn again', () => {
    const state = new GameState(loopWorld())
    state.move('right')
    const after = state.current
    // A later move that creates nothing reports no Spawn event: the ε is merely Active.
    const visuals = classifyEpsilonVisuals(after, after, [])
    expect([...visuals.values()]).toEqual(['Active'])
  })

  it('undoing the creation reports the ε as Remove', () => {
    const state = new GameState(loopWorld())
    state.move('right')
    const withEps = state.current
    state.undo()
    expect([...classifyEpsilonVisuals(withEps, state.current, []).values()]).toEqual(['Remove'])
  })

  it('replay: re-deriving from the same world + events reconstructs the same visual state', () => {
    const w = loopWorld()
    const a = new GameState(w)
    a.move('right')
    const b = new GameState(w)
    b.move('right')
    expect(classifyEpsilonVisuals(w, a.current, a.lastEvents)).toEqual(classifyEpsilonVisuals(w, b.current, b.lastEvents))
    expect(applyMove(w, 'right')).not.toBeNull()
  })
})

describe('renderer honors the per-piece spawn scale', () => {
  const draw = (scale: number) => {
    const state = new GameState(loopWorld())
    state.move('right')
    const world = state.current
    const voidBoard = world.boards.void
    const rects: number[] = []
    const glyphs: string[] = []
    const alphas: number[] = []
    const ctx = {
      fillRect: (_x: number, _y: number, w: number) => { rects.push(w) },
      strokeRect: () => {}, save: () => {}, restore: () => {},
      fillText: (t: string) => { glyphs.push(t) },
      beginPath: () => {}, rect: () => {}, arc: () => {}, moveTo: () => {}, fill: () => {},
      set globalAlpha(v: number) { alphas.push(v) }, get globalAlpha() { return 1 },
      fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D
    const eps = Object.values(world.pieces).find((p) => p.epsilonFor !== undefined)!.id
    drawBoardRecursive(
      {
        ctx, world,
        camera: { anchor: 'void', centerX: 2.5, centerY: 2.5, pixelsPerRootUnit: 64 },
        viewport: { width: 320, height: 320 }, budget: DEFAULT_RENDER_BUDGET,
        piecesByBoard: indexPiecesByBoard(world), cellsDrawnSoFar: { count: 0 },
        getPieceScale: (id) => (id === eps ? scale : 1),
      },
      voidBoard, { boardId: 'void', originX: 0, originY: 0, scale: 1 }, 0, 0, false,
    )
    return { rects, glyphs, alphas }
  }

  it('scale 0 draws nothing for the ε; scale 1 draws it with the ε glyph', () => {
    expect(draw(0).glyphs).not.toContain('ε')
    expect(draw(1).glyphs).toContain('ε')
  })

  it('a growing ε is drawn smaller and faded than a full one', () => {
    const growing = draw(0.5)
    expect(growing.glyphs).toContain('ε')
    expect(growing.alphas).toContain(0.5)
  })
})
