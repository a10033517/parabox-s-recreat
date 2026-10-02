import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { cameraForFocus, clampCameraZoom, worldToScreen, cameraFallbackForAnchor, interpolateCamera } from './camera'
import { makeFloorBoard, makeWorld } from '../engine/testFixtures'
import { PLAYER_ID, VOID_BOARD_ID } from '../engine/types'

// Third-party example levels (docs/differential/community-samples, no licence) are kept out of
// the public repository; tests that need one skip when it is not present locally.
const SAMPLE_DIR = join(__dirname, '../../../docs/differential/community-samples')
const hasSample = (name: string) => existsSync(join(SAMPLE_DIR, name))


describe('clampCameraZoom', () => {
  it('passes through an in-range value unchanged', () => {
    expect(clampCameraZoom(100)).toBe(100)
  })
  it('clamps a non-finite or non-positive value to the minimum', () => {
    expect(clampCameraZoom(NaN)).toBeGreaterThan(0)
    expect(clampCameraZoom(Infinity)).toBeLessThan(Infinity)
    expect(clampCameraZoom(-5)).toBeGreaterThan(0)
    expect(clampCameraZoom(0)).toBeGreaterThan(0)
  })
  it('clamps an extreme value into [min, max]', () => {
    expect(clampCameraZoom(1e12)).toBeLessThan(1e12)
    expect(clampCameraZoom(1e-12)).toBeGreaterThan(1e-12)
  })
})

describe('worldToScreen', () => {
  it('maps the camera center to the exact viewport center', () => {
    const camera = { centerX: 5, centerY: 5, pixelsPerRootUnit: 32, anchor: 'root' as const }
    const viewport = { width: 400, height: 300 }
    expect(worldToScreen(5, 5, camera, viewport)).toEqual({ x: 200, y: 150 })
  })
  it('scales offsets from center by pixelsPerRootUnit', () => {
    const camera = { centerX: 0, centerY: 0, pixelsPerRootUnit: 10, anchor: 'root' as const }
    const viewport = { width: 100, height: 100 }
    expect(worldToScreen(1, 2, camera, viewport)).toEqual({ x: 60, y: 70 })
  })
})

describe('cameraForFocus', () => {
  const viewport = { width: 600, height: 400 } // short side 400
  const budget = { marginCells: 1 }

  it('player on the anchor board: frames the whole board plus one cell of margin, centred on the board', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 1, y: 2 } })
    const camera = cameraForFocus(world, viewport, budget)
    expect(camera.anchor).toBe('root')
    expect(camera.centerX).toBeCloseTo(2)
    expect(camera.centerY).toBeCloseTo(2)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(400 / (4 + 2))
  })

  it("player inside a box: frames that box, drawn as big as the level's own room", () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'inside', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } },
    )
    const camera = cameraForFocus(world, viewport, budget)
    expect(camera.centerX).toBeCloseTo(2.5)
    expect(camera.centerY).toBeCloseTo(1.5)
    // The root room (4 cells + 1 margin each side) fills 4/6 of the short side; the box (one
    // root unit) fills the same 4/6 once the player is inside it.
    expect(camera.pixelsPerRootUnit).toBeCloseTo((400 * 4) / 6)
    const rootCamera = cameraForFocus(makeWorld([root, inside], [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }], { [PLAYER_ID]: { board: 'root', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } }), viewport, budget)
    expect(1 * camera.pixelsPerRootUnit).toBeCloseTo(4 * rootCamera.pixelsPerRootUnit)
  })

  it('an ordinary step on the same board does not move the camera', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 3)
    const make = (x: number, y: number) => makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'inside', x, y }, box: { board: 'root', x: 2, y: 1 } },
    )
    expect(cameraForFocus(make(0, 0), viewport, budget)).toEqual(cameraForFocus(make(2, 1), viewport, budget))
    const onRoot = (x: number) => makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x, y: 0 } })
    expect(cameraForFocus(onRoot(0), viewport, budget)).toEqual(cameraForFocus(onRoot(3), viewport, budget))
  })

  it('frames the genuine outer container, not a self-loop inside the same board', () => {
    const root = makeFloorBoard('root', 5)
    const interior = makeFloorBoard('interior', 3)
    const world = makeWorld(
      [root, interior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'outer', kind: 'container', boardRef: 'interior', exitBlock: true }, // the canonical exit (findContainerFor)
        { id: 'loop', kind: 'container', boardRef: 'interior' },
      ],
      { [PLAYER_ID]: { board: 'interior', x: 0, y: 0 }, outer: { board: 'root', x: 3, y: 1 }, loop: { board: 'interior', x: 2, y: 2 } },
    )
    const camera = cameraForFocus(world, viewport, budget)
    expect(camera.centerX).toBeCloseTo(3.5)
    expect(camera.centerY).toBeCloseTo(1.5)
  })

  it('player in the Void: void anchor, the whole Void board plus margin', () => {
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 7)
    const world = makeWorld([voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    const camera = cameraForFocus(world, viewport, budget)
    expect(camera.anchor).toBe('void')
    expect(camera.centerX).toBeCloseTo(3.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(400 / 9)
  })

  it('falls back to a finite camera when the player has no location', () => {
    const world = makeWorld([makeFloorBoard('root', 3)], [], {})
    const camera = cameraForFocus(world, viewport, budget)
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })

  it('falls back to a finite camera when the player board is unreachable from the anchor', () => {
    const world = makeWorld(
      [makeFloorBoard('root', 2), makeFloorBoard('a', 2), makeFloorBoard('b', 2)],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'ca', kind: 'container', boardRef: 'a' },
        { id: 'cb', kind: 'container', boardRef: 'b' },
      ],
      { [PLAYER_ID]: { board: 'a', x: 0, y: 0 }, ca: { board: 'b', x: 0, y: 0 }, cb: { board: 'a', x: 0, y: 0 } },
    )
    const camera = cameraForFocus(world, viewport, budget)
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })

  it('pure-cycle level: standing on the cached anchor board frames that board itself (branch decided by F === anchor)', () => {
    const start = makeFloorBoard('start', 2)
    const redInterior = makeFloorBoard('redInterior', 1)
    const world = makeWorld(
      [start, redInterior],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'redPiece', kind: 'container', boardRef: 'redInterior' },
        { id: 'yellowPiece', kind: 'container', boardRef: 'start' },
      ],
      { [PLAYER_ID]: { board: 'start', x: 0, y: 0 }, redPiece: { board: 'start', x: 1, y: 0 }, yellowPiece: { board: 'redInterior', x: 0, y: 0 } },
    )
    const camera = cameraForFocus(world, viewport, budget, 'start')
    expect(camera.centerX).toBeCloseTo(1)
    expect(camera.centerY).toBeCloseTo(1)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(400 / 4)
  })
})

describe('cameraFallbackForAnchor', () => {
  it('returns a finite camera for the given anchor', () => {
    const camera = cameraFallbackForAnchor('void', { width: 300, height: 300 }, { marginCells: 1 })
    expect(camera.anchor).toBe('void')
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(100)
  })
})

describe.skipIf(!hasSample('file_format_example.txt'))('file_format_example: inside a box whose exitblock Ref sits in its own interior (user-reported, 2026-09-26)', () => {
  it('the camera anchors on the green loop itself (green inside green), not the root and not a fallback corner', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { parseOfficialLevel } = await import('../engine/officialFormat')
    const { applyMove } = await import('../engine/rules')
    const { resolveAnchorBoardId } = await import('./recursiveTransform')
    const text = readFileSync(join(__dirname, '../../../docs/differential/community-samples/file_format_example.txt'), 'utf8')
    const start = parseOfficialLevel(text)
    const anchorBoardId = resolveAnchorBoardId(start, 'root')!
    // Find (by BFS over real moves) a state with the player inside the green box.
    type Dir = 'up' | 'down' | 'left' | 'right'
    let frontier = [start]
    const seen = new Set([JSON.stringify(start.locations)])
    let inside = undefined as typeof start | undefined
    for (let d = 0; d < 12 && inside === undefined; d++) {
      const next: typeof frontier = []
      for (const w of frontier) for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) {
        const n = applyMove(w, dir)
        if (n === null) continue
        const k = JSON.stringify(n.locations)
        if (seen.has(k)) continue
        seen.add(k)
        if (n.locations[PLAYER_ID].board === 'b1') inside = inside ?? n
        next.push(n)
      }
      frontier = next
    }
    expect(inside).toBeDefined()
    const viewport = { width: 300, height: 300 }
    const camera = cameraForFocus(inside!, viewport, { marginCells: 1 }, anchorBoardId)
    // Walking out of b1 only leads back into b1 (its exit Ref is inside it): b1 is the world.
    expect(camera.anchorBoardId).toBe('b1')
    expect(camera.centerX).toBeCloseTo(1.5)
    expect(camera.centerY).toBeCloseTo(1.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(300 / (3 + 2))
    // Outside the loop (on the root board) the level anchor is used as before.
    expect(cameraForFocus(start, viewport, { marginCells: 1 }, anchorBoardId).anchorBoardId).toBeUndefined()
  })
})

describe('interpolateCamera', () => {
  const source = { anchor: 'root' as const, centerX: 3.5, centerY: 3.5, pixelsPerRootUnit: 50 }
  const target = { anchor: 'root' as const, centerX: 5.5, centerY: 2.5, pixelsPerRootUnit: 350 }

  it('starts at the source and ends exactly at the target', () => {
    expect(interpolateCamera(source, target, 0)).toMatchObject(source)
    const end = interpolateCamera(source, target, 1)
    expect(end.centerX).toBeCloseTo(target.centerX)
    expect(end.centerY).toBeCloseTo(target.centerY)
    expect(end.pixelsPerRootUnit).toBeCloseTo(target.pixelsPerRootUnit)
  })

  it('zooms geometrically: half way is the geometric mean, like a gliding piece\'s size', () => {
    expect(interpolateCamera(source, target, 0.5).pixelsPerRootUnit).toBeCloseTo(Math.sqrt(50 * 350))
  })

  it('the point being zoomed into stays at the same place on screen the whole way', () => {
    const viewport = { width: 400, height: 400 }
    // The fixed point of the zoom: same screen position in source and target.
    const fx = (target.centerX * 350 - source.centerX * 50) / (350 - 50)
    const fy = (target.centerY * 350 - source.centerY * 50) / (350 - 50)
    const start = worldToScreen(fx, fy, source, viewport)
    for (const t of [0.25, 0.5, 0.75]) {
      const p = worldToScreen(fx, fy, interpolateCamera(source, target, t), viewport)
      expect(p.x).toBeCloseTo(start.x)
      expect(p.y).toBeCloseTo(start.y)
    }
  })

  it('without a zoom change it is a plain slide', () => {
    const a = { ...source, pixelsPerRootUnit: 80 }
    const b = { ...target, pixelsPerRootUnit: 80 }
    expect(interpolateCamera(a, b, 0.5).centerX).toBeCloseTo(4.5)
  })
})
