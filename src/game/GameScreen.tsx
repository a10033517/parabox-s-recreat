import { useEffect, useRef, useState } from 'react'
import { GameState } from './engine/GameState'
import { BoardId, Direction, Location, PieceId, PLAYER_ID, VOID_BOARD_ID, World } from './engine/types'
import { DrawContext, DEFAULT_RENDER_BUDGET, drawBoardRecursive, indexPiecesByBoard } from './render/CanvasRenderer'
import { CameraTransform, Viewport, cameraForPlayer } from './render/camera'
import { resolveAnchorBoardId } from './render/recursiveTransform'
import { DPad } from '../ui/DPad'
import { SwipeLayer } from '../ui/SwipeLayer'

export type AnimationKind = 'move' | 'enter-leave' | 'teleport' | 'void-transition'

interface RenderAnimation {
  preWorld: World
  postWorld: World
  startTimeMs: number
  durationMs: number
  kind: AnimationKind
  sourceCamera: CameraTransform
  targetCamera: CameraTransform
}

const DURATIONS: Record<AnimationKind, number> = {
  move: 120,
  'enter-leave': 250,
  teleport: 400,
  'void-transition': 400,
}

// Exported (rather than module-private) so the animation layer's own logic can be
// unit-tested directly against real pre/post World pairs, instead of only indirectly
// through end-state assertions that would pass against a broken/no-op animation
// implementation too (final-review I5).
export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function isSimpleContainmentStep(world: World, oldBoard: string, newBoard: string): boolean {
  const newOwner = Object.values(world.pieces).find((p) => p.kind === 'container' && p.boardRef === newBoard)
  if (newOwner !== undefined && world.locations[newOwner.id]?.board === oldBoard) return true
  const oldOwner = Object.values(world.pieces).find((p) => p.kind === 'container' && p.boardRef === oldBoard)
  if (oldOwner !== undefined && world.locations[oldOwner.id]?.board === newBoard) return true
  return false
}

export function classifyMove(preWorld: World, postWorld: World): AnimationKind {
  const oldBoard = preWorld.locations[PLAYER_ID]?.board
  const newBoard = postWorld.locations[PLAYER_ID]?.board
  if (oldBoard === undefined || newBoard === undefined || oldBoard === newBoard) return 'move'
  if (oldBoard === VOID_BOARD_ID || newBoard === VOID_BOARD_ID) return 'void-transition'
  if (isSimpleContainmentStep(postWorld, oldBoard, newBoard)) return 'enter-leave'
  return 'teleport'
}

export function getRenderLocationFactory(preWorld: World, postWorld: World, t: number) {
  return (pieceId: PieceId): Location | undefined => {
    const pre = preWorld.locations[pieceId]
    const post = postWorld.locations[pieceId]
    if (post === undefined) return pre
    if (pre === undefined || pre.board !== post.board) return post
    return { board: post.board, x: lerp(pre.x, post.x, t), y: lerp(pre.y, post.y, t) }
  }
}

export function GameScreen({
  initialWorld,
  onExit,
  onWin,
}: {
  initialWorld: World
  onExit: () => void
  onWin: () => void
}) {
  const stateRef = useRef<GameState>()
  if (!stateRef.current) stateRef.current = new GameState(initialWorld)
  const state = stateRef.current

  // Resolved ONCE per level load (from the level's initial World, same lazy-init idiom
  // as stateRef above), never re-derived from live/possibly-player-relocated World
  // snapshots on every frame or every move — see resolveCanonicalBoardTransform's and
  // cameraForPlayer's own cachedRootAnchorBoardId doc (final-review I3). Undefined
  // sentinel distinguishes "not yet computed" from a legitimate null result (an
  // unreachable/malformed world), so a null result is still cached rather than retried.
  const rootAnchorBoardIdRef = useRef<BoardId | null | undefined>(undefined)
  if (rootAnchorBoardIdRef.current === undefined) {
    rootAnchorBoardIdRef.current = resolveAnchorBoardId(initialWorld, 'root')
  }
  const rootAnchorBoardId = rootAnchorBoardIdRef.current ?? undefined

  const [, setTick] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wonRef = useRef(false)
  const viewportRef = useRef<Viewport>({ width: 320, height: 320 })
  const animationRef = useRef<RenderAnimation | null>(null)

  const handleMove = (direction: Direction) => {
    const preMoveWorld = state.current
    const moved = state.move(direction)
    if (!moved) return
    const postMoveWorld = state.current
    const kind = classifyMove(preMoveWorld, postMoveWorld)
    const budget = { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }
    animationRef.current = {
      preWorld: preMoveWorld,
      postWorld: postMoveWorld,
      startTimeMs: performance.now(),
      durationMs: DURATIONS[kind],
      kind,
      sourceCamera: cameraForPlayer(preMoveWorld, budget, rootAnchorBoardId),
      targetCamera: cameraForPlayer(postMoveWorld, budget, rootAnchorBoardId),
    }
    setTick((t) => t + 1)
  }

  const handleUndo = () => {
    if (state.undo()) {
      wonRef.current = false
      animationRef.current = null // cancel any in-flight animation — undo settles instantly
      setTick((t) => t + 1)
    }
  }

  useEffect(() => {
    if (state.isWon && !wonRef.current) {
      wonRef.current = true
      onWin()
    }
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateViewport = () => {
      viewportRef.current = { width: el.clientWidth || 320, height: el.clientHeight || 320 }
    }
    updateViewport()
    // jsdom (this project's test environment) does not implement ResizeObserver at all —
    // the initial size captured above still applies; a real browser gets live resizing.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateViewport)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const map: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      const direction = map[e.key]
      if (direction) handleMove(direction)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let rafId: number

    const frame = () => {
      const viewport = viewportRef.current
      const dpr = window.devicePixelRatio || 1
      const targetWidth = Math.round(viewport.width * dpr)
      const targetHeight = Math.round(viewport.height * dpr)
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, viewport.width, viewport.height)

      const anim = animationRef.current
      let world = state.current
      let camera: CameraTransform
      let dimAlpha = 0 // Void-transition darken overlay, 0..1

      if (anim !== null) {
        const rawT = (performance.now() - anim.startTimeMs) / anim.durationMs
        if (rawT >= 1) {
          animationRef.current = null
          world = state.current
          camera = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }, rootAnchorBoardId)
        } else {
          const t = easeOut(Math.max(0, rawT))
          if (anim.kind === 'void-transition' || anim.sourceCamera.anchor !== anim.targetCamera.anchor) {
            // Anchors are never interpolated (§12) — two-phase darken/swap/fade instead.
            if (t < 0.5) {
              world = anim.preWorld
              camera = anim.sourceCamera
              dimAlpha = t / 0.5
            } else {
              world = anim.postWorld
              camera = anim.targetCamera
              dimAlpha = 1 - (t - 0.5) / 0.5
            }
          } else {
            world = anim.postWorld
            camera = {
              anchor: anim.targetCamera.anchor,
              centerX: lerp(anim.sourceCamera.centerX, anim.targetCamera.centerX, t),
              centerY: lerp(anim.sourceCamera.centerY, anim.targetCamera.centerY, t),
              pixelsPerRootUnit: lerp(anim.sourceCamera.pixelsPerRootUnit, anim.targetCamera.pixelsPerRootUnit, t),
            }
          }
        }
      } else {
        camera = cameraForPlayer(world, { targetPlayerCellPixels: DEFAULT_RENDER_BUDGET.targetPlayerCellPixels }, rootAnchorBoardId)
      }

      // Same cached anchor id used for the camera above — the Void anchor case is
      // unaffected (VOID_BOARD_ID is always an unambiguous constant, no caching needed).
      const anchorBoardId =
        camera.anchor === 'root' && rootAnchorBoardId !== undefined
          ? rootAnchorBoardId
          : resolveAnchorBoardId(world, camera.anchor)
      if (anchorBoardId !== null && world.boards[anchorBoardId] !== undefined) {
        const currentAnim = animationRef.current
        const dc: DrawContext = {
          ctx,
          world,
          camera,
          viewport,
          budget: DEFAULT_RENDER_BUDGET,
          piecesByBoard: indexPiecesByBoard(world),
          cellsDrawnSoFar: { count: 0 },
          getRenderLocation:
            currentAnim !== null && currentAnim.kind === 'move'
              ? getRenderLocationFactory(currentAnim.preWorld, currentAnim.postWorld, easeOut(Math.max(0, Math.min(1, (performance.now() - currentAnim.startTimeMs) / currentAnim.durationMs))))
              : undefined,
        }
        drawBoardRecursive(dc, world.boards[anchorBoardId], { boardId: anchorBoardId, originX: 0, originY: 0, scale: 1 }, 0, 0, false)
      }

      if (dimAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${dimAlpha})`
        ctx.fillRect(0, 0, viewport.width, viewport.height)
      }

      rafId = requestAnimationFrame(frame)
    }
    // Call frame() synchronously once on mount, in addition to the RAF scheduling
    // inside frame() itself for every subsequent tick — found necessary during Task 6:
    // scheduling the very first call via requestAnimationFrame alone means the canvas
    // stays at its default/stale size for one frame after every mount (a real visible
    // flash in production, and what made Task 6's viewport-size test flaky under RTL,
    // since assertions run before that first deferred RAF callback ever fires).
    frame()
    return () => cancelAnimationFrame(rafId)
  }, [state])

  return (
    <div className="game-screen">
      <div className="hud">
        <span>步数: {state.moveCount}</span>
        <button onClick={handleUndo}>复位上一步</button>
        <button onClick={onExit}>离开</button>
      </div>
      <SwipeLayer onMove={handleMove}>
        <div ref={containerRef} className="game-viewport">
          <canvas ref={canvasRef} />
        </div>
      </SwipeLayer>
      <DPad onMove={handleMove} />
    </div>
  )
}
