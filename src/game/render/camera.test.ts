import { describe, it, expect } from 'vitest'
import { cameraForPlayer, clampCameraZoom, worldToScreen, cameraFallbackForAnchor } from './camera'
import { makeFloorBoard, makeWorld } from '../engine/testFixtures'
import { PLAYER_ID, VOID_BOARD_ID } from '../engine/types'

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

describe('cameraForPlayer', () => {
  it('centers a player standing directly on the anchor board at that cell\'s center', () => {
    const root = makeFloorBoard('root', 4)
    const world = makeWorld([root], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: 'root', x: 1, y: 2 } })
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(camera.anchor).toBe('root')
    expect(camera.centerX).toBeCloseTo(1.5) // x + 0.5, scale 1
    expect(camera.centerY).toBeCloseTo(2.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(64) // targetPlayerCellPixels / scale(1)
  })

  it('zooms in further for a player nested two levels deep, per targetPlayerCellPixels / boardScale', () => {
    const root = makeFloorBoard('root', 4)
    const inside = makeFloorBoard('inside', 2)
    const world = makeWorld(
      [root, inside],
      [{ id: PLAYER_ID, kind: 'player' }, { id: 'box', kind: 'container', boardRef: 'inside' }],
      { [PLAYER_ID]: { board: 'inside', x: 0, y: 0 }, box: { board: 'root', x: 2, y: 1 } },
    )
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    // inside's transform: originX 2, originY 1, scale 0.5 (root size 4)
    expect(camera.centerX).toBeCloseTo(2 + 0.5 * 0.5) // originX + (0+0.5)*scale
    expect(camera.centerY).toBeCloseTo(1 + 0.5 * 0.5)
    expect(camera.pixelsPerRootUnit).toBeCloseTo(64 / 0.5) // = 128, more zoomed in than the root case
  })

  it('selects the void anchor for a player standing in the Void', () => {
    const voidBoard = makeFloorBoard(VOID_BOARD_ID, 5)
    const world = makeWorld([voidBoard], [{ id: PLAYER_ID, kind: 'player' }], { [PLAYER_ID]: { board: VOID_BOARD_ID, x: 2, y: 2 } })
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(camera.anchor).toBe('void')
  })

  it('falls back to a defined default instead of NaN when the player has no location', () => {
    const root = makeFloorBoard('root', 3)
    const world = makeWorld([root], [], {})
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.centerY)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })

  it('falls back to a defined default when the player\'s board has no reachable canonical transform', () => {
    // ca/cb mutual cycle disconnected from root, player placed on 'a' (unreachable) —
    // same shape as recursiveTransform.test.ts's disconnected-cycle fixture.
    const root = makeFloorBoard('root', 2)
    const a = makeFloorBoard('a', 2)
    const b = makeFloorBoard('b', 2)
    const world = makeWorld(
      [root, a, b],
      [
        { id: PLAYER_ID, kind: 'player' },
        { id: 'ca', kind: 'container', boardRef: 'a' },
        { id: 'cb', kind: 'container', boardRef: 'b' },
      ],
      {
        [PLAYER_ID]: { board: 'a', x: 0, y: 0 },
        ca: { board: 'b', x: 0, y: 0 },
        cb: { board: 'a', x: 0, y: 0 },
      },
    )
    const camera = cameraForPlayer(world, { targetPlayerCellPixels: 64 })
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })
})

describe('cameraFallbackForAnchor', () => {
  it('returns a finite camera for the given anchor', () => {
    const camera = cameraFallbackForAnchor('void', 64)
    expect(camera.anchor).toBe('void')
    expect(Number.isFinite(camera.centerX)).toBe(true)
    expect(Number.isFinite(camera.pixelsPerRootUnit)).toBe(true)
  })
})
